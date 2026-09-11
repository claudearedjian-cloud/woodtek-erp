// ============================================================================
// Custom-role storage — SERVER ONLY (node imports). JSON file in <project>/data
// (survives rebuilds, covered by backups). Keeps the permissions.ts registry
// in sync so baseRoleOf()/allRoles() know about custom roles on the server.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { getCustomRoles, getModuleOverrides, registerCustomRoles, registerModuleOverrides, type CustomRole } from "@/lib/permissions";

export interface RolesConfig {
  version: 1;
  roles: CustomRole[];
  /** Per-role screen overrides (Manager edits in Settings > Manage roles). */
  overrides: Record<string, string[]>;
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
    registerModuleOverrides(parsed?.overrides);
    const cfg: RolesConfig = { version: 1, roles: getCustomRoles(), overrides: { ...getModuleOverrides() } };
    cache = { mtimeMs: st.mtimeMs, cfg };
    return cfg;
  } catch {
    registerModuleOverrides({});
    return { version: 1, roles: [], overrides: {} };
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

/** Validates an untrusted overrides map (API body) and returns the clean map. */
export function sanitizeOverrides(input: unknown): Record<string, string[]> {
  registerModuleOverrides(input);
  return { ...getModuleOverrides() };
}

export function writeRolesConfig(roles: CustomRole[], overrides: Record<string, string[]> = {}): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, roles, overrides }, null, 2), "utf8");
  cache = null; // force re-read on next access
}
