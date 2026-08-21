// Shared type contracts used by web, server, and extension.
// This file only grows as later milestones need it — kept minimal for now.

export type ApplicationStatus =
  | "saved"
  | "applying"
  | "applied"
  | "interview"
  | "offer"
  | "rejected";

export interface EducationEntry {
  institution: string;
  degree?: string;
  fieldOfStudy?: string;
  startDate?: string;
  endDate?: string;
  gpa?: string;
}

export interface ExperienceEntry {
  company: string;
  title: string;
  startDate?: string;
  endDate?: string;
  location?: string;
  highlights: string[];
}

export interface ProjectEntry {
  name: string;
  description: string;
  technologies: string[];
  url?: string;
}

export interface CertificationEntry {
  name: string;
  issuer?: string;
  date?: string;
}

export interface CareerProfile {
  id: string;
  resumeId: string;
  name?: string;
  email?: string;
  phone?: string;
  location?: string;
  linkedin?: string;
  github?: string;
  portfolio?: string;
  education: EducationEntry[];
  experience: ExperienceEntry[];
  skills: string[];
  projects: ProjectEntry[];
  certifications: CertificationEntry[];
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

export interface ProfileParseRequest {
  resumeId: string;
}
