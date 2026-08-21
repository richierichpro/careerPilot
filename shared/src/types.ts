// Shared type contracts used by web, server, and extension.
// This file only grows as later milestones need it — kept minimal for now.

export type ApplicationStatus =
  | "saved"
  | "applying"
  | "applied"
  | "interview"
  | "offer"
  | "rejected";

export interface CareerProfile {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  education: unknown[];
  experience: unknown[];
  skills: unknown[];
  projects: unknown[];
  certifications: unknown[];
  workAuthorization?: string;
  salaryExpectation?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Application {
  id: string;
  company: string;
  jobTitle: string;
  jobUrl: string;
  dateApplied: string;
  status: ApplicationStatus;
  source?: string;
  notes?: string;
}

export interface HealthCheckResponse {
  status: "ok";
  service: string;
  timestamp: string;
}

export interface ResumeUploadResponse {
  resumeId: string;
  filename: string;
  size: number;
  uploadedAt: string;
}

export interface ApiErrorResponse {
  error: string;
}
