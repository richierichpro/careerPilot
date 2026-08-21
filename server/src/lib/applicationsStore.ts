import fs from "node:fs";
import path from "node:path";
import type { Application } from "@careerpilot/shared";

// Native modules like better-sqlite3 have to be compiled per-platform —
// fragile across build/runtime environment mismatches (confirmed: it
// segfaulted on Railway's Nixpacks deploy, compiled fine but crashing at
// startup). Application records are a small list, so a single JSON file —
// the same pattern already used for Career Profiles — sidesteps that whole
// class of problem entirely, at the cost of no real concurrent-write
// safety, which this single-process app doesn't need anyway.
const STORE_PATH = process.env.APPLICATIONS_PATH
  ? path.resolve(process.cwd(), process.env.APPLICATIONS_PATH)
  : path.join(process.cwd(), "data", "applications.json");

fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });

function readAll(): Application[] {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf-8");
    return JSON.parse(raw) as Application[];
  } catch {
    return [];
  }
}

function writeAll(applications: Application[]): void {
  fs.writeFileSync(STORE_PATH, JSON.stringify(applications, null, 2));
}

export function listApplications(): Application[] {
  return readAll().sort((a, b) => b.dateApplied.localeCompare(a.dateApplied));
}

export function insertApplication(application: Application): void {
  const all = readAll();
  all.push(application);
  writeAll(all);
}

export function getApplication(id: string): Application | undefined {
  return readAll().find((a) => a.id === id);
}

export function updateApplication(id: string, updated: Application): void {
  const all = readAll();
  const index = all.findIndex((a) => a.id === id);
  if (index === -1) return;
  all[index] = updated;
  writeAll(all);
}

export function deleteApplication(id: string): boolean {
  const all = readAll();
  const index = all.findIndex((a) => a.id === id);
  if (index === -1) return false;
  all.splice(index, 1);
  writeAll(all);
  return true;
}
