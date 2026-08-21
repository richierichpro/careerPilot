import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type {
  ApiErrorResponse,
  AutofillRequest,
  AutofillResponse,
  CareerProfile,
  DetectConfirmationRequest,
  DetectConfirmationResponse,
  DetectedField,
} from "@careerpilot/shared";
import { anthropic } from "../lib/anthropicClient";

const PROFILES_DIR = path.join(process.cwd(), "data", "profiles");

const AnswerSchema = z.object({
  answers: z.array(
    z.object({
      id: z.string(),
      value: z.string(),
      grounded: z.boolean(),
    }),
  ),
});

const ConfirmationSchema = z.object({
  submitted: z.boolean(),
  reasoning: z.string(),
});

const CONFIRMATION_SYSTEM_PROMPT = [
  "You determine whether a job application was actually, successfully",
  "submitted, by reading the visible text of whatever page the browser is",
  "currently on after the user clicked a real ATS site's own Submit button.",
  "Real application-tracking systems land on very different pages after a",
  "submission — a dedicated 'thank you' page, a candidate dashboard listing",
  "the application under a status like 'Under Consideration' or 'Applied',",
  "or something else entirely. Say submitted=true only if the page content",
  "genuinely indicates a specific application for the given job (or a very",
  "close match — company/title may be paraphrased) was received or is now",
  "being tracked/considered. Say submitted=false for a login screen, an",
  "in-progress multi-step form, an error, an unrelated page, or a dashboard",
  "that does NOT actually list this specific application. Briefly explain",
  "your reasoning either way.",
].join(" ");

const AUTOFILL_SYSTEM_PROMPT = [
  "You fill out a job application form on behalf of a candidate, using ONLY",
  "the candidate's Career Profile (verified resume data) and the job context",
  "provided to you as JSON. For each form field, write a value grounded in",
  "that profile data — this includes reasonable synthesis (e.g. summarizing",
  "relevant experience in a sentence, or writing a short paragraph for 'why",
  "do you want to work here' that references the candidate's real skills",
  "and the job's real description) but NEVER invent a company, title, skill,",
  "degree, accomplishment, or fact that is not present in the profile or job",
  "context. If a field asks for something the profile does not contain (for",
  "example a portfolio URL when none is listed), set grounded to false and",
  "value to an empty string — do not guess or fabricate a plausible-looking",
  "answer. Set grounded to true only when the value is actually backed by",
  "the profile or job context. Return exactly one answer per field id given,",
  "in the same order, echoing the id exactly.",
].join(" ");

export const autofillRouter = Router();

autofillRouter.post("/generate", async (req, res) => {
  const { profileId, jobContext, fields } = req.body as Partial<AutofillRequest>;

  if (!profileId || typeof profileId !== "string") {
    const body: ApiErrorResponse = { error: "profileId is required." };
    res.status(400).json(body);
    return;
  }
  if (!Array.isArray(fields) || fields.length === 0) {
    const body: ApiErrorResponse = { error: "fields must be a non-empty array." };
    res.status(400).json(body);
    return;
  }
  if (!jobContext || typeof jobContext !== "object") {
    const body: ApiErrorResponse = { error: "jobContext is required." };
    res.status(400).json(body);
    return;
  }

  let profile: CareerProfile;
  try {
    const raw = await fs.readFile(path.join(PROFILES_DIR, `${profileId}.json`), "utf-8");
    profile = JSON.parse(raw) as CareerProfile;
  } catch {
    const body: ApiErrorResponse = { error: "Career Profile not found." };
    res.status(404).json(body);
    return;
  }

  const typedFields = fields as DetectedField[];

  try {
    const userContent = JSON.stringify(
      {
        careerProfile: profile,
        jobContext,
        fields: typedFields,
      },
      null,
      2,
    );

    const response = await anthropic.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: AUTOFILL_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Fill out this application form using the candidate's profile:\n\n${userContent}`,
        },
      ],
      output_config: {
        format: zodOutputFormat(AnswerSchema),
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      const body: ApiErrorResponse = { error: "The AI could not generate answers for this form." };
      res.status(502).json(body);
      return;
    }

    const body: AutofillResponse = { answers: parsed.answers };
    res.json(body);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      const body: ApiErrorResponse = {
        error: "Anthropic API key is missing or invalid on the server.",
      };
      res.status(500).json(body);
      return;
    }
    if (err instanceof Anthropic.RateLimitError) {
      const body: ApiErrorResponse = { error: "Rate limited by Anthropic. Try again shortly." };
      res.status(429).json(body);
      return;
    }
    if (err instanceof Anthropic.APIError) {
      const body: ApiErrorResponse = { error: `Anthropic API error: ${err.message}` };
      res.status(502).json(body);
      return;
    }
    const message = err instanceof Error ? err.message : "Autofill generation failed.";
    const body: ApiErrorResponse = { error: message };
    res.status(500).json(body);
  }
});

autofillRouter.post("/detect-confirmation", async (req, res) => {
  const { jobContext, currentUrl, pageText } = req.body as Partial<DetectConfirmationRequest>;

  if (!jobContext || typeof jobContext !== "object") {
    const body: ApiErrorResponse = { error: "jobContext is required." };
    res.status(400).json(body);
    return;
  }
  if (!currentUrl || !pageText) {
    const body: ApiErrorResponse = { error: "currentUrl and pageText are required." };
    res.status(400).json(body);
    return;
  }

  try {
    const userContent = JSON.stringify(
      { jobContext, currentUrl, pageText: pageText.slice(0, 4000) },
      null,
      2,
    );

    const response = await anthropic.messages.parse({
      model: "claude-opus-5",
      max_tokens: 1024,
      system: CONFIRMATION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Was this application actually submitted?\n\n${userContent}`,
        },
      ],
      output_config: {
        format: zodOutputFormat(ConfirmationSchema),
      },
    });

    const parsed = response.parsed_output;
    if (!parsed) {
      const body: ApiErrorResponse = { error: "The AI could not evaluate this page." };
      res.status(502).json(body);
      return;
    }

    const body: DetectConfirmationResponse = parsed;
    res.json(body);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      const body: ApiErrorResponse = {
        error: "Anthropic API key is missing or invalid on the server.",
      };
      res.status(500).json(body);
      return;
    }
    if (err instanceof Anthropic.RateLimitError) {
      const body: ApiErrorResponse = { error: "Rate limited by Anthropic. Try again shortly." };
      res.status(429).json(body);
      return;
    }
    if (err instanceof Anthropic.APIError) {
      const body: ApiErrorResponse = { error: `Anthropic API error: ${err.message}` };
      res.status(502).json(body);
      return;
    }
    const message = err instanceof Error ? err.message : "Confirmation detection failed.";
    const body: ApiErrorResponse = { error: message };
    res.status(500).json(body);
  }
});
