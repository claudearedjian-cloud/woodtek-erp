// ============================================================================
// Appearance & Branding — SERVER ONLY (node imports).
// Reads/writes <project>/data/appearance.json.
//
// Same mtime-cached + atomic-write pattern as installed-edition.json and
// menu-config.json: the file is read on every document render, and a crash
// mid-write must never leave a truncated JSON behind.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "@/lib/atomicFile.server";
import {
  APPEARANCE_DEFAULTS,
  sanitizeAppearance,
  type AppearanceConfig,
} from "@/lib/appearance";

export const APPEARANCE_FILE = "appearance.json";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, APPEARANCE_FILE);
}

let cache: { filePath: string; mtimeMs: number; cfg: AppearanceConfig } | null = null;

/** Reads appearance.json (mtime-cached) or the defaults when it is absent. */
export function readAppearance(): AppearanceConfig {
  const loc = fileLocation();
  try {
    const st = fs.statSync(loc);
    if (cache && cache.filePath === loc && cache.mtimeMs === st.mtimeMs) {
      return cache.cfg;
    }
    const cfg = sanitizeAppearance(JSON.parse(fs.readFileSync(loc, "utf8")));
    cache = { filePath: loc, mtimeMs: st.mtimeMs, cfg };
    return cfg;
  } catch {
    return APPEARANCE_DEFAULTS;
  }
}

/** Writes appearance.json atomically and refreshes the read cache. */
export function writeAppearance(input: unknown): AppearanceConfig {
  const cfg = sanitizeAppearance(input);
  const loc = fileLocation();
  writeJsonAtomic(loc, cfg);
  cache = { filePath: loc, mtimeMs: fs.statSync(loc).mtimeMs, cfg };
  return cfg;
}
