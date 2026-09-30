import fs from "node:fs";
import path from "node:path";

/**
 * Atomic JSON file write — same no-migration pattern the other data stores
 * already use (bom-status, dispatch-status, packing-qc, …): serialize to a
 * unique temp file in the same directory, then rename it over the target.
 *
 * Why: `fs.writeFileSync(file, …)` truncates the target first; a crash or
 * power cut mid-write leaves a truncated / half-written JSON file that every
 * future read fails to parse. A rename within the same directory is atomic
 * on POSIX and Windows/NTFS — readers see either the old file or the new
 * one, never a partial write.
 *
 * (2026-09-30: previously only SOME stores used this pattern — the audit
 * log, material progress, material routes and roles config wrote directly.
 * They now all go through this helper.)
 */
export function writeJsonAtomic(file: string, data: unknown): void {
  const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
    fs.renameSync(temp, file);
  } catch (error) {
    try {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    } catch {
      /* best-effort cleanup; the original file is untouched */
    }
    throw error;
  }
}
