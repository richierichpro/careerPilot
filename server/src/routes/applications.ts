import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { ApiErrorResponse, Application, ApplicationStatus } from "@careerpilot/shared";
import { db } from "../lib/db";

const VALID_STATUSES: ApplicationStatus[] = [
  "saved",
  "applying",
  "applied",
  "interview",
  "offer",
  "rejected",
];

interface ApplicationRow {
  id: string;
  company: string;
  jobTitle: string;
  jobUrl: string;
  dateApplied: string;
  status: ApplicationStatus;
  source: string | null;
  notes: string | null;
}

function rowToApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    company: row.company,
    jobTitle: row.jobTitle,
    jobUrl: row.jobUrl,
    dateApplied: row.dateApplied,
    status: row.status,
    source: row.source ?? undefined,
    notes: row.notes ?? undefined,
  };
}

export const applicationsRouter = Router();

applicationsRouter.get("/", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM applications ORDER BY dateApplied DESC")
    .all() as ApplicationRow[];
  res.json(rows.map(rowToApplication));
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

  db.prepare(
    `INSERT INTO applications (id, company, jobTitle, jobUrl, dateApplied, status, source, notes)
     VALUES (@id, @company, @jobTitle, @jobUrl, @dateApplied, @status, @source, @notes)`,
  ).run({
    ...application,
    source: application.source ?? null,
    notes: application.notes ?? null,
  });

  res.status(201).json(application);
});

applicationsRouter.patch("/:id", (req, res) => {
  const existingRow = db
    .prepare("SELECT * FROM applications WHERE id = ?")
    .get(req.params.id) as ApplicationRow | undefined;

  if (!existingRow) {
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

  const updated: Application = { ...rowToApplication(existingRow), ...body, id: existingRow.id };

  db.prepare(
    `UPDATE applications
     SET company=@company, jobTitle=@jobTitle, jobUrl=@jobUrl, dateApplied=@dateApplied,
         status=@status, source=@source, notes=@notes
     WHERE id=@id`,
  ).run({
    ...updated,
    source: updated.source ?? null,
    notes: updated.notes ?? null,
  });

  res.json(updated);
});
