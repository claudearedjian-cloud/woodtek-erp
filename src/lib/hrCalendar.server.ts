// ============================================================================
// Working-calendar / holiday / overtime-policy persistence — SERVER ONLY.
//
// data/hr-calendar.json (mtime-cached, atomic writes) — the same no-migration
// pattern as hr-job-titles.json and warehouses.json. The calendar is one
// company-wide setting (work days, daily hours, public holidays, overtime
// multipliers and the leave-access rules), so a JSON register keeps it out of
// the database and out of every installer migration.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "@/lib/atomicFile.server";
import {
  defaultHrCalendar,
  sanitizeHrCalendar,
  type HrCalendarConfig,
} from "@/lib/hrCalendar";

const FILE_NAME = "hr-calendar.json";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, FILE_NAME);
}

let cache: { filePath: string; mtimeMs: number; size: number; config: HrCalendarConfig } | null = null;

/** The saved calendar, or null when the file does not exist / cannot be read. */
export function readHrCalendarFile(): HrCalendarConfig | null {
  const loc = fileLocation();
  try {
    const st = fs.statSync(loc);
    if (cache && cache.filePath === loc && cache.mtimeMs === st.mtimeMs && cache.size === st.size) {
      return cache.config;
    }
    const parsed = JSON.parse(fs.readFileSync(loc, "utf8"));
    const config = sanitizeHrCalendar(parsed);
    cache = { filePath: loc, mtimeMs: st.mtimeMs, size: st.size, config };
    return config;
  } catch {
    return null;
  }
}

/** Saved calendar, else the factory default (Mon–Fri, 08:00–17:00, no holidays). */
export function readHrCalendar(): HrCalendarConfig {
  return readHrCalendarFile() ?? defaultHrCalendar();
}

/** Validates untrusted input and writes it atomically; returns the clean copy. */
export function writeHrCalendar(input: unknown): HrCalendarConfig {
  const config = sanitizeHrCalendar(input);
  const loc = fileLocation();
  // sanitizeHrCalendar already stamps the register envelope (version: 1), the
  // same as every other JSON file in data/, so a restore or a hand edit stays
  // recognizable.
  writeJsonAtomic(loc, config);
  cache = { filePath: loc, mtimeMs: fs.statSync(loc).mtimeMs, size: fs.statSync(loc).size, config };
  return config;
}
