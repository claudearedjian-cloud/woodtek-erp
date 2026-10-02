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
import {
  hasInstalledEditionFile,
  readInstalledEdition,
} from "@/lib/installedEdition.server";

export const OPTIONAL_MODULES_FILE = "optional-modules.json";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, OPTIONAL_MODULES_FILE);
}

let cache: { filePath: string; mtimeMs: number; cfg: OptionalModulesConfig } | null = null;

function applyEditionLock(base: OptionalModulesConfig): OptionalModulesConfig {
  if (!hasInstalledEditionFile()) return base;
  const edition = readInstalledEdition();
  return sanitizeOptionalModules({
    ...base,
    installedAddons: edition.addons,
  });
}

/** Reads the grant file (mtime-cached) and returns a validated config. */
export function readOptionalModules(): OptionalModulesConfig {
  const loc = fileLocation();
  try {
    const st = fs.statSync(loc);
    if (cache && cache.filePath === loc && cache.mtimeMs === st.mtimeMs) {
      return applyEditionLock(cache.cfg);
    }
    const parsed = JSON.parse(fs.readFileSync(loc, "utf8"));
    const cfg = sanitizeOptionalModules(parsed);
    cache = { filePath: loc, mtimeMs: st.mtimeMs, cfg };
    return applyEditionLock(cfg);
  } catch {
    // No file, unreadable file or corrupt JSON: fall back to today's access.
    return applyEditionLock(defaultOptionalModulesConfig());
  }
}

/** Validates and writes the config atomically, then drops the cache. */
export function writeOptionalModules(input: OptionalModulesConfig): OptionalModulesConfig {
  const locked = applyEditionLock(sanitizeOptionalModules(input));
  const diskPayload: OptionalModulesConfig = {
    version: 1,
    enabled: locked.enabled,
    roles: locked.roles,
    users: locked.users,
  };
  writeJsonAtomic(fileLocation(), diskPayload);
  cache = null; // force a re-read on the next access
  return applyEditionLock(diskPayload);
}
