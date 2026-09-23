// ============================================================================
// SMTP config storage — SERVER ONLY (node imports).
// File: <WOODTEK_DATA_DIR>/email-config.json (default <project>/data).
// Atomic write: temp file + rename, same no-migration pattern as the other
// JSON stores. The clear password lives here on disk only — every API
// response is produced with maskEmailConfig().
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_EMAIL_CONFIG,
  sanitizeEmailConfig,
  type EmailConfig,
} from "@/lib/emailConfig";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "email-config.json");
}

/** Missing or corrupt file = the factory default (SMTP not configured). */
export function readEmailConfig(): EmailConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    return sanitizeEmailConfig(parsed);
  } catch {
    return { ...DEFAULT_EMAIL_CONFIG };
  }
}

export function writeEmailConfig(cfg: EmailConfig): void {
  const file = fileLocation();
  const clean = sanitizeEmailConfig(cfg);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(clean, null, 2), "utf8");
  fs.renameSync(temp, file);
}
