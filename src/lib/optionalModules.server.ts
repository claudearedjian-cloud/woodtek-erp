// ============================================================================
// Optional-module grants — SERVER ONLY (node imports). JSON file in
// <project>/data (survives rebuilds, covered by backups), same no-migration
// pattern as roles-config.json and the other stores.
//
// Deliberately silent on first run: when data/optional-modules.json does not
// exist the factory default from optionalModules.ts applies (Invoicing on,
// Sales Coordinator granted) and NOTHING is written. Switching this system on
// therefore removes nobody's access, and the disk only changes once a Manager
// actually saves in Settings.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "@/lib/atomicFile.server";
import {
  defaultOptionalModulesConfig,
  sanitizeOptionalModules,
  type OptionalModulesConfig,
} from "@/lib/optionalModules";

export const OPTIONAL_MODULES_FILE = "optional-modules.json";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, OPTIONAL_MODULES_FILE);
}

let cache: { mtimeMs: number; cfg: OptionalModulesConfig } | null = null;

/** Reads the grant file (mtime-cached) and returns a validated config. */
export function readOptionalModules(): OptionalModulesConfig {
  try {
    const st = fs.statSync(fileLocation());
    if (cache && cache.mtimeMs === st.mtimeMs) return cache.cfg;
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    const cfg = sanitizeOptionalModules(parsed);
    cache = { mtimeMs: st.mtimeMs, cfg };
    return cfg;
  } catch {
    // No file, unreadable file or corrupt JSON: fall back to today's access.
    return defaultOptionalModulesConfig();
  }
}

/** Validates and writes the config atomically, then drops the cache. */
export function writeOptionalModules(input: OptionalModulesConfig): OptionalModulesConfig {
  const clean = sanitizeOptionalModules(input);
  writeJsonAtomic(fileLocation(), clean);
  cache = null; // force a re-read on the next access
  return clean;
}
