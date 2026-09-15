// ============================================================================
// Material production stage — server-side storage + the automatic moves that
// happen when a machine step starts/completes (see computeAutoAdvance in the
// pure lib). NEVER throws into the caller: production must not break because
// a tracking file could not be written.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { sanitizeProgressMap } from "@/lib/materialProgress";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "material-progress.json");
}

export function readAllProgress(): Record<string, { stage: string; at: string; by: string }> {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    return sanitizeProgressMap(parsed?.progress);
  } catch {
    return {};
  }
}

export function writeAllProgress(progress: Record<string, { stage: string; at: string; by: string }>): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, progress }, null, 2), "utf8");
}


