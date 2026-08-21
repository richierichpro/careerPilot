import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { ApiErrorResponse, CareerProfile, ProfileParseRequest } from "@careerpilot/shared";
import { anthropic } from "../lib/anthropicClient";
import { extractResumeText } from "../lib/extractResumeText";

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");
const PROFILES_DIR = path.join(process.cwd(), "data", "profiles");

// Anthropic's structured-output schemas cap nullable/union-typed fields at 16
// across the whole schema tree. Rather than mark every optional field
// `.nullable()` (which blew past that limit), every field here is a required
// string/array and the model is instructed to emit "" / [] when a resume
// doesn't state something — converted back to `undefined` after parsing.
const EducationSchema = z.object({
  institution: z.string(),
  degree: z.string(),
  fieldOfStudy: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  gpa: z.string(),
});

const ExperienceSchema = z.object({
  company: z.string(),
  title: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  location: z.string(),
  highlights: z.array(z.string()),
});

const ProjectSchema = z.object({
  name: z.string(),
  description: z.string(),
  technologies: z.array(z.string()),
  url: z.string(),
});

const CertificationSchema = z.object({
  name: z.string(),
  issuer: z.string(),
  date: z.string(),
});

const CareerProfileExtractionSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  linkedin: z.string(),
  github: z.string(),
  portfolio: z.string(),
  education: z.array(EducationSchema),
  experience: z.array(ExperienceSchema),
  skills: z.array(z.string()),
  projects: z.array(ProjectSchema),
  certifications: z.array(CertificationSchema),
  workAuthorization: z.string(),
  salaryExpectation: z.string(),
});

const EXTRACTION_SYSTEM_PROMPT = [
  "You extract structured career profile data from resume text.",
  "Only include information explicitly present in the resume text — never invent",
  "companies, job titles, dates, skills, degrees, certifications, or accomplishments.",
  "Every field in the schema is required, so use an empty string \"\" for any single",
  "value that is not stated in the resume, and an empty array for list fields with",
  "no entries — never write null, \"N/A\", or \"Unknown\". Different resumes describe",
  "the same concept in different words — normalize by meaning, not by literal",
  "keyword matching. For example, 'Software Engineering Intern at Acme Corp' is a",
  "work experience entry with company 'Acme Corp' and title 'Software Engineering",
  "Intern'.",
].join(" ");

function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

async function findUploadedFile(resumeId: string): Promise<string | null> {
  const files = await fs.readdir(UPLOADS_DIR).catch(() => [] as string[]);
  const match = files.find((f) => path.parse(f).name === resumeId);
  return match ? path.join(UPLOADS_DIR, match) : null;
}

export const profileRouter = Router();

profileRouter.post("/parse", async (req, res) => {
  const { resumeId } = req.body as Partial<ProfileParseRequest>;
  if (!resumeId || typeof resumeId !== "string") {
    const body: ApiErrorResponse = { error: "resumeId is required." };
    res.status(400).json(body);
    return;
  }

  const filePath = await findUploadedFile(resumeId);
  if (!filePath) {
    const body: ApiErrorResponse = { error: "Resume not found. Upload it again." };
    res.status(404).json(body);
    return;
  }

  try {
    const resumeText = await extractResumeText(filePath);

    if (!resumeText.trim()) {
      const body: ApiErrorResponse = {
        error: "Could not read any text from this resume. Try a different file.",
      };
      res.status(422).json(body);
      return;
    }

    const response = await anthropic.messages.parse({
      model: "claude-opus-5",
      max_tokens: 16000,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: `Extract a career profile from this resume:\n\n${resumeText}`,
        },
      ],
      output_config: {
        format: zodOutputFormat(CareerProfileExtractionSchema),
      },
    });

    const extracted = response.parsed_output;
    if (!extracted) {
      const body: ApiErrorResponse = {
        error: "The AI could not extract a profile from this resume. Try again.",
      };
      res.status(502).json(body);
      return;
    }

    const now = new Date().toISOString();
    const profile: CareerProfile = {
      id: randomUUID(),
      resumeId,
      name: blankToUndefined(extracted.name),
      email: blankToUndefined(extracted.email),
      phone: blankToUndefined(extracted.phone),
      location: blankToUndefined(extracted.location),
      linkedin: blankToUndefined(extracted.linkedin),
      github: blankToUndefined(extracted.github),
      portfolio: blankToUndefined(extracted.portfolio),
      education: extracted.education.map((e) => ({
        institution: e.institution,
        degree: blankToUndefined(e.degree),
        fieldOfStudy: blankToUndefined(e.fieldOfStudy),
        startDate: blankToUndefined(e.startDate),
        endDate: blankToUndefined(e.endDate),
        gpa: blankToUndefined(e.gpa),
      })),
      experience: extracted.experience.map((e) => ({
        company: e.company,
        title: e.title,
        startDate: blankToUndefined(e.startDate),
        endDate: blankToUndefined(e.endDate),
        location: blankToUndefined(e.location),
        highlights: e.highlights,
      })),
      skills: extracted.skills,
      projects: extracted.projects.map((p) => ({
        name: p.name,
        description: p.description,
        technologies: p.technologies,
        url: blankToUndefined(p.url),
      })),
      certifications: extracted.certifications.map((c) => ({
        name: c.name,
        issuer: blankToUndefined(c.issuer),
        date: blankToUndefined(c.date),
      })),
      workAuthorization: blankToUndefined(extracted.workAuthorization),
      salaryExpectation: blankToUndefined(extracted.salaryExpectation),
      createdAt: now,
      updatedAt: now,
    };

    await fs.mkdir(PROFILES_DIR, { recursive: true });
    await fs.writeFile(
      path.join(PROFILES_DIR, `${profile.id}.json`),
      JSON.stringify(profile, null, 2),
    );

    res.json(profile);
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
    const message = err instanceof Error ? err.message : "Resume parsing failed.";
    const body: ApiErrorResponse = { error: message };
    res.status(500).json(body);
  }
});

profileRouter.get("/:id", async (req, res) => {
  try {
    const raw = await fs.readFile(path.join(PROFILES_DIR, `${req.params.id}.json`), "utf-8");
    res.json(JSON.parse(raw) as CareerProfile);
  } catch {
    const body: ApiErrorResponse = { error: "Profile not found." };
    res.status(404).json(body);
  }
});
