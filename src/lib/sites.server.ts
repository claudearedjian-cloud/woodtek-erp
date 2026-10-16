// ============================================================================
// Factory structure persistence — SERVER ONLY.
//
// data/factory-sites.json      company, branches, floors
// data/site-assignments.json   warehouses / floors each user supervises
//
// Same no-migration pattern as warehouses.json: atomic writes, and a missing
// file means the defaults (company SAAD GROUPE, one "Main factory" branch).
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "@/lib/atomicFile.server";
import {
  DEFAULT_SITES,
  sanitizeAssignments,
  sanitizeSites,
  type SiteAssignments,
  type SitesConfig,
} from "@/lib/sites";

const SITES_FILE = "factory-sites.json";
const ASSIGNMENTS_FILE = "site-assignments.json";

function fileLocation(name: string): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, name);
}

function readJson(name: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(fileLocation(name), "utf8"));
  } catch {
    return null;
  }
}

/** The saved factory structure, or the defaults when nothing is saved yet. */
export function readSitesConfig(): SitesConfig {
  const parsed = readJson(SITES_FILE) as Record<string, unknown> | null;
  if (!parsed) return sanitizeSites(DEFAULT_SITES);
  return sanitizeSites(parsed);
}

export function writeSitesConfig(config: SitesConfig): SitesConfig {
  const clean = sanitizeSites(config);
  writeJsonAtomic(fileLocation(SITES_FILE), { version: 1, ...clean });
  return clean;
}

export function readSiteAssignments(): SiteAssignments {
  const parsed = readJson(ASSIGNMENTS_FILE) as Record<string, unknown> | null;
  return sanitizeAssignments(parsed?.assignments);
}

export function writeSiteAssignments(map: SiteAssignments): SiteAssignments {
  const clean = sanitizeAssignments(map);
  writeJsonAtomic(fileLocation(ASSIGNMENTS_FILE), { version: 1, assignments: clean });
  return clean;
}

/** Drops assignments that point at a warehouse or floor that no longer exists. */
export function pruneAssignments(
  map: SiteAssignments,
  live: { warehouseIds: Set<string>; floorIds: Set<string> },
): SiteAssignments {
  const out: SiteAssignments = {};
  for (const [userId, value] of Object.entries(map)) {
    const warehouseIds = value.warehouseIds.filter((id) => live.warehouseIds.has(id));
    const floorIds = value.floorIds.filter((id) => live.floorIds.has(id));
    if (warehouseIds.length || floorIds.length) out[userId] = { warehouseIds, floorIds };
  }
  return out;
}
