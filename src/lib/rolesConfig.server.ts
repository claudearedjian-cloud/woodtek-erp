// ============================================================================
// Custom-role storage — SERVER ONLY (node imports). JSON file in <project>/data
// (survives rebuilds, covered by backups). Keeps the permissions.ts registry
// in sync so baseRoleOf()/allRoles() know about custom roles on the server.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { getCustomRoles, registerCustomRoles, type CustomRole } from "@/lib/permissions";

export interface RolesConfig {
  version: 1;
  roles: CustomRole[];
}

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "roles-config.json");
}

let cache: { mtimeMs: number; cfg: RolesConfig } | null = null;

export function readRolesConfig(): RolesConfig {
  try {
    const st = fs.statSync(fileLocation());
    if (cache && cache.mtimeMs === st.mtimeMs) return cache.cfg;
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    registerCustomRoles(parsed?.roles); // validates while registering
    const cfg: RolesConfig = { version: 1, roles: getCustomRoles() };
    cache = { mtimeMs: st.mtimeMs, cfg };
    return cfg;
  } catch {
    return { version: 1, roles: [] };
  }
}

/** Call before using baseRoleOf()/allRoles() in any server code path. */
export function ensureRolesRegistered(): void {
  readRolesConfig();
}

/** Validates untrusted input (API body) and returns the clean list. */
export function sanitizeRoles(input: unknown): CustomRole[] {
  registerCustomRoles(input);
  return getCustomRoles();
}

export function writeRolesConfig(roles: CustomRole[]): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, roles }, null, 2), "utf8");
  cache = null; // force re-read on next access
}
