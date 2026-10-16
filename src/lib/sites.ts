// ============================================================================
// Factory structure: company -> branches (factory locations) -> floors and
// warehouses. Pure and client-safe (no server or browser APIs), so the
// Settings screen, the user form and the render tests all share one model.
//
// Storage (server only, see sites.server.ts):
//   data/factory-sites.json      company name, branches, floors
//   data/site-assignments.json   which warehouses / floors a user supervises
//
// A Warehouse Supervisor is linked to warehouses; a Floor Supervisor is linked
// to floors. Each floor belongs to exactly one branch, and each warehouse
// belongs to exactly one branch.
// ============================================================================

export const DEFAULT_COMPANY_NAME = "SAAD GROUPE";
/** The branch every warehouse falls back to until it is given a branch. */
export const DEFAULT_BRANCH_ID = "main";
export const MAX_BRANCHES = 20;
export const MAX_FLOORS = 200;
export const MAX_ASSIGNED_PER_USER = 50;

const NAME_MAX = 60;
const CODE_MAX = 12;
const ADDRESS_MAX = 160;
const ID_MAX = 60;

export interface SiteBranch {
  id: string;
  name: string;
  code: string;
  address: string;
  active: boolean;
  createdAt: string;
}

export interface SiteFloor {
  id: string;
  branchId: string;
  name: string;
  code: string;
  active: boolean;
  createdAt: string;
}

export interface SitesConfig {
  company: string;
  branches: SiteBranch[];
  floors: SiteFloor[];
}

export interface SiteAssignment {
  warehouseIds: string[];
  floorIds: string[];
}

/** Keyed by the user's database id (as a string). */
export type SiteAssignments = Record<string, SiteAssignment>;

const EPOCH = "1970-01-01T00:00:00.000Z";

export const DEFAULT_SITES: SitesConfig = {
  company: DEFAULT_COMPANY_NAME,
  branches: [
    { id: DEFAULT_BRANCH_ID, name: "Main factory", code: "MAIN", address: "", active: true, createdAt: EPOCH },
  ],
  floors: [],
};

function cleanText(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Lower-case slug for ids; falls back when nothing usable is left. */
export function slugSiteId(value: unknown, fallback: string): string {
  const slug = String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || fallback;
}

/** `base`, or `base-2`, `base-3`… so the id is not already taken. */
export function uniqueSiteId(base: string, taken: Set<string>): string {
  let id = base.slice(0, ID_MAX);
  let bump = 2;
  while (taken.has(id)) {
    id = `${base}-${bump}`.slice(0, ID_MAX);
    bump += 1;
  }
  return id;
}

function isoOrNow(value: unknown): string {
  if (typeof value === "string" && !Number.isNaN(new Date(value).getTime())) return new Date(value).toISOString();
  return new Date().toISOString();
}

export interface SitesSanitizeResult {
  config: SitesConfig;
  /** Floors and branches dropped because they were blank, repeated or orphaned. */
  dropped: number;
}

/**
 * Cleans an untrusted sites document. Names are unique (branch names across
 * the factory, floor names inside one branch). A floor must point at a branch
 * that exists. With no usable branch, the default branch is used so warehouses
 * always have somewhere to belong.
 */
export function sanitizeSitesReport(raw: unknown): SitesSanitizeResult {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  let dropped = 0;

  const company = cleanText(source.company, NAME_MAX) || DEFAULT_COMPANY_NAME;

  const branches: SiteBranch[] = [];
  const branchIds = new Set<string>();
  const branchNames = new Set<string>();
  const rawBranches = Array.isArray(source.branches) ? source.branches : [];
  for (const entry of rawBranches) {
    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const name = cleanText(item?.name, NAME_MAX);
    if (!item || !name || branchNames.has(name.toLowerCase()) || branches.length >= MAX_BRANCHES) {
      dropped += 1;
      continue;
    }
    const id = uniqueSiteId(slugSiteId(item.id || name, "branch"), branchIds);
    branchIds.add(id);
    branchNames.add(name.toLowerCase());
    branches.push({
      id,
      name,
      code: cleanText(item.code, CODE_MAX).toUpperCase(),
      address: cleanText(item.address, ADDRESS_MAX),
      active: item.active === undefined ? true : Boolean(item.active),
      createdAt: isoOrNow(item.createdAt),
    });
  }
  if (branches.length === 0) {
    branches.push({ ...DEFAULT_SITES.branches[0], createdAt: new Date().toISOString() });
    branchIds.add(DEFAULT_BRANCH_ID);
  }

  const floors: SiteFloor[] = [];
  const floorIds = new Set<string>();
  const floorNamesByBranch = new Set<string>();
  const rawFloors = Array.isArray(source.floors) ? source.floors : [];
  for (const entry of rawFloors) {
    const item = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
    const name = cleanText(item?.name, NAME_MAX);
    const branchId = cleanText(item?.branchId, ID_MAX);
    const key = `${branchId}\u0000${name.toLowerCase()}`;
    if (!item || !name || !branchIds.has(branchId) || floorNamesByBranch.has(key) || floors.length >= MAX_FLOORS) {
      dropped += 1;
      continue;
    }
    floorNamesByBranch.add(key);
    const id = uniqueSiteId(slugSiteId(item.id || `${branchId} ${name}`, "floor"), floorIds);
    floorIds.add(id);
    floors.push({
      id,
      branchId,
      name,
      code: cleanText(item.code, CODE_MAX).toUpperCase(),
      active: item.active === undefined ? true : Boolean(item.active),
      createdAt: isoOrNow(item.createdAt),
    });
  }

  return { config: { company, branches, floors }, dropped };
}

export function sanitizeSites(raw: unknown): SitesConfig {
  return sanitizeSitesReport(raw).config;
}

/** Floors of one branch, in the saved order. */
export function floorsOfBranch(config: SitesConfig, branchId: string): SiteFloor[] {
  return config.floors.filter((floor) => floor.branchId === branchId);
}

export function branchExists(config: SitesConfig, branchId: unknown): boolean {
  return config.branches.some((branch) => branch.id === branchId);
}

/**
 * Cleans the per-user assignment map. Ids are kept as given (existence is
 * checked by the API against the live warehouse and floor lists).
 */
export function sanitizeAssignments(raw: unknown): SiteAssignments {
  const out: SiteAssignments = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [userId, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(userId)) continue;
    const item = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
    const list = (input: unknown) =>
      Array.from(new Set((Array.isArray(input) ? input : []).map((id) => cleanText(id, ID_MAX)).filter(Boolean))).slice(
        0,
        MAX_ASSIGNED_PER_USER,
      );
    const warehouseIds = list(item.warehouseIds);
    const floorIds = list(item.floorIds);
    if (warehouseIds.length || floorIds.length) out[userId] = { warehouseIds, floorIds };
  }
  return out;
}

/** The warehouses and floors one user supervises (empty when none). */
export function assignmentFor(assignments: SiteAssignments, userId: number | string): SiteAssignment {
  return assignments[String(userId)] ?? { warehouseIds: [], floorIds: [] };
}
