import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { ApiErrorResponse, Application, ApplicationStatus } from "@careerpilot/shared";
import {
  deleteApplication,
  getApplication,
  insertApplication,
  listApplications,
  updateApplication,
} from "../lib/applicationsStore";

const VALID_STATUSES: ApplicationStatus[] = [
  "saved",
  "applying",
  "applied",
  "interview",
  "offer",
  "rejected",
];

export const applicationsRouter = Router();

applicationsRouter.get("/", (_req, res) => {
  res.json(listApplications());
});

applicationsRouter.post("/", (req, res) => {
  const body = req.body as Partial<Application>;

  if (!body.company || !body.jobTitle || !body.jobUrl) {
    const err: ApiErrorResponse = { error: "company, jobTitle, and jobUrl are required." };
    res.status(400).json(err);
    return;
  }
  if (body.status && !VALID_STATUSES.includes(body.status)) {
    const err: ApiErrorResponse = { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` };
    res.status(400).json(err);
    return;
  }

  const application: Application = {
    id: randomUUID(),
    company: body.company,
    jobTitle: body.jobTitle,
    jobUrl: body.jobUrl,
    dateApplied: body.dateApplied ?? new Date().toISOString(),
    status: body.status ?? "applied",
    source: body.source,
    notes: body.notes,
  };

  insertApplication(application);
  res.status(201).json(application);
});

applicationsRouter.patch("/:id", (req, res) => {
  const existing = getApplication(req.params.id);
  if (!existing) {
    const err: ApiErrorResponse = { error: "Application not found." };
    res.status(404).json(err);
    return;
  }

  const body = req.body as Partial<Application>;
  if (body.status && !VALID_STATUSES.includes(body.status)) {
    const err: ApiErrorResponse = { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` };
    res.status(400).json(err);
    return;
  }

  const updated: Application = { ...existing, ...body, id: existing.id };
  updateApplication(existing.id, updated);
  res.json(updated);
});

applicationsRouter.delete("/:id", (req, res) => {
  const ok = deleteApplication(req.params.id);
  if (!ok) {
    const err: ApiErrorResponse = { error: "Application not found." };
    res.status(404).json(err);
    return;
  }
  res.status(204).end();
});
