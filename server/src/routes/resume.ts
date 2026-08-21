import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import type { ApiErrorResponse, ResumeUploadResponse } from "@careerpilot/shared";

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
]);

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname);
      cb(null, `${randomUUID()}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(new Error("Unsupported file type. Upload a PDF, DOC, DOCX, or TXT file."));
      return;
    }
    cb(null, true);
  },
});

export const resumeRouter = Router();

resumeRouter.post("/upload", (req, res) => {
  upload.single("resume")(req, res, (err: unknown) => {
    if (err) {
      const message = err instanceof Error ? err.message : "Upload failed.";
      const body: ApiErrorResponse = { error: message };
      res.status(400).json(body);
      return;
    }

    if (!req.file) {
      const body: ApiErrorResponse = { error: "No file uploaded." };
      res.status(400).json(body);
      return;
    }

    const body: ResumeUploadResponse = {
      resumeId: path.parse(req.file.filename).name,
      filename: req.file.originalname,
      size: req.file.size,
      uploadedAt: new Date().toISOString(),
    };
    res.json(body);
  });
});
