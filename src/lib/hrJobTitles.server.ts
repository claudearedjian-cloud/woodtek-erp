// ============================================================================
// Editable HR job-description list — SERVER ONLY (node imports). JSON file in
// <project>/data (survives rebuilds, covered by backups). This is the list an
// HR user picks from when the employee's system role does not describe the
// actual job (Worker, Cleaner, Driver, …). Free text stays allowed in the
// profile itself — this file is only the suggestions.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "@/lib/atomicFile.server";
import {
  DEFAULT_JOB_TITLES,
  MAX_JOB_TITLES,
  MAX_JOB_TITLE_LEN,
  parseJobTitles,
} from "@/lib/hrPayroll";

export interface JobTitlesConfig {
  version: 1;
  titles: string[];
}

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "hr-job-titles.json");
}

let cache: { mtimeMs: number; titles: string[] } | null = null;

function defaults(): string[] {
  return [...DEFAULT_JOB_TITLES];
}

/** HR suggestions; falls back to the factory defaults when never edited. */
export function readJobTitles(): string[] {
  try {
    const st = fs.statSync(fileLocation());
    if (cache && cache.mtimeMs === st.mtimeMs) return [...cache.titles];
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    const raw = Array.isArray(parsed) ? parsed : parsed?.titles;
    const titles = parseJobTitles(raw ?? []);
    cache = { mtimeMs: st.mtimeMs, titles };
    return [...titles];
  } catch {
    return defaults();
  }
}

/** Validates untrusted input (API body) and returns the clean list. */
export function sanitizeJobTitles(input: unknown): string[] {
  const titles = parseJobTitles(
    Array.isArray(input) ? input : (input as { titles?: unknown } | null)?.titles ?? input,
  );
  return titles.slice(0, MAX_JOB_TITLES).map((t) => t.slice(0, MAX_JOB_TITLE_LEN));
}

export function writeJobTitles(titles: string[]): void {
  const clean = sanitizeJobTitles(titles);
  writeJsonAtomic(fileLocation(), { version: 1, titles: clean } satisfies JobTitlesConfig);
  cache = null; // force re-read on next access
}
