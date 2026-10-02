// ============================================================================
// Installed Edition — SERVER ONLY (node imports).
// Reads <project>/data/installed-edition.json written by WoodTek-ERP-Setup.exe.
//
// When the file does not exist (e.g. an existing factory PC before the
// installer was used, or CI/dev), defaultInstalledEdition() applies (all four
// add-on packs installed) and NOTHING is written to disk.
//
// Deliberately there is NO web PUT route for this file: the installed edition
// is a hard installation-level lock and can only be changed by re-running the
// Windows installer (or the local administrator CLI script on the server PC).
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "@/lib/atomicFile.server";
import {
  defaultInstalledEdition,
  sanitizeInstalledEdition,
  type InstalledEditionConfig,
} from "@/lib/installedEdition";

export const INSTALLED_EDITION_FILE = "installed-edition.json";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, INSTALLED_EDITION_FILE);
}

let cache: { filePath: string; mtimeMs: number; cfg: InstalledEditionConfig } | null = null;

/** True when an explicit installed-edition.json file exists on disk. */
export function hasInstalledEditionFile(): boolean {
  try {
    return fs.existsSync(fileLocation());
  } catch {
    return false;
  }
}

/** Reads the installed-edition file (mtime-cached) or returns Full Edition default. */
export function readInstalledEdition(): InstalledEditionConfig {
  const loc = fileLocation();
  try {
    const st = fs.statSync(loc);
    if (cache && cache.filePath === loc && cache.mtimeMs === st.mtimeMs) {
      return cache.cfg;
    }
    const parsed = JSON.parse(fs.readFileSync(loc, "utf8"));
    const cfg = sanitizeInstalledEdition(parsed);
    cache = { filePath: loc, mtimeMs: st.mtimeMs, cfg };
    return cfg;
  } catch {
    return defaultInstalledEdition();
  }
}

/** Writes the installed-edition file atomically (used by installer/CLI/tests). */
export function writeInstalledEdition(input: unknown): InstalledEditionConfig {
  const clean = sanitizeInstalledEdition(input);
  writeJsonAtomic(fileLocation(), clean);
  cache = null;
  return clean;
}
