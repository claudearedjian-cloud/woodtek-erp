// ============================================================================
// Optional modules — money and HR/payroll as grants to a role or person
// ============================================================================
//
// The owner's rule: money and HR must work like OPTIONAL MODULES. Switched off
// for everybody, then handed to a role and/or to a single person. This file is
// the pure, client-safe half of that switch system — the registry, the
// resolution rule, the money rule, the screen rule, the sanitizer and the
// audit summariser. Nothing here touches the filesystem, so the Settings card
// and the server store can share one implementation.
//
// The ENFORCEMENT point is `authorizeModule()` in src/lib/auth.ts: it is what
// returns a 403. The sidebar, the page guard and the menu only HIDE things —
// hiding a screen is not hiding data, so every read path that can return money
// is gated on `canSeeMoney()` at the API level as well.
// ============================================================================

import {
  INSTALLER_ADDON_IDS,
  isOptionalModuleInstalled,
  isScreenInstalled,
  type InstallerAddonId,
} from "@/lib/installedEdition";

export type OptionalModuleId = "invoicing" | "purchasing" | "payroll";

export const OPTIONAL_MODULE_IDS: readonly OptionalModuleId[] = [
  "invoicing",
  "purchasing",
  "payroll",
] as const;

export interface OptionalModuleDef {
  id: OptionalModuleId;
  label: string;
  description: string;
  /** false = the registry row exists but the module has not shipped yet. */
  ready: boolean;
}

export const OPTIONAL_MODULES: readonly OptionalModuleDef[] = [
  {
    id: "invoicing",
    label: "Invoicing & Money",
    description:
      "VAT quotations & invoices, payments, A/R aging — plus every money column: order values, material costs, client balances and credit limits, profitability and reports.",
    ready: true,
  },
  {
    id: "purchasing",
    label: "Purchasing & Suppliers",
    description:
      "Suppliers, purchase orders, awaiting deliveries and goods receipts that add stock. Supplier bills, payments and A/P aging additionally require Invoicing & Money.",
    ready: true,
  },
  {
    id: "payroll",
    label: "HR & Payroll",
    description:
      "Employee pay profiles, leave and absence tracking, monthly payroll drafts, manual earnings/deductions and printable payslips.",
    ready: true,
  },
] as const;

/**
 * Sidebar screens owned by an optional module. Other modules stay empty until
 * their own screens ship. A grant is enforced on server routes separately.
 */
export const OPTIONAL_MODULE_SCREENS: Record<OptionalModuleId, readonly string[]> = {
  invoicing: ["invoicing", "jobcosting"],
  purchasing: ["purchasing"],
  payroll: ["hr"],
};

/** The module that governs money visibility everywhere in the app. */
export const MONEY_MODULE: OptionalModuleId = "invoicing";

/**
 * Manager can never lose an optional module: every grant UI pins it and the
 * resolution rule short-circuits on it. Without this, a Manager could switch
 * money off for their own role and lock themselves out of the factory's books.
 */
export const MANAGER_ROLE = "Manager";

export interface OptionalModulesConfig {
  version: 1;
  /** Master switches — a module that is not enabled is off for everybody. */
  enabled: OptionalModuleId[];
  /** Role grants, keyed by role name (built-in or custom). */
  roles: Record<string, OptionalModuleId[]>;
  /** Personal grants, keyed by user id (stored as a string, JSON has no ints). */
  users: Record<string, OptionalModuleId[]>;
  /**
   * Hard installation lock (set by WoodTek-ERP-Setup.exe via
   * data/installed-edition.json). When present, any add-on omitted from this
   * list is locked out for everybody (including Manager) and cannot be enabled
   * in Settings. When omitted, all four add-ons default to installed.
   */
  installedAddons?: InstallerAddonId[];
}

/** Anything that can be evaluated for a grant: a session user, or a bare role. */
export type ModuleSubject =
  | { id?: number | null; role?: string | null; displayRole?: string | null }
  | null
  | undefined;

export function isOptionalModuleId(value: unknown): value is OptionalModuleId {
  return typeof value === "string" && (OPTIONAL_MODULE_IDS as readonly string[]).includes(value);
}

export function moduleDef(id: OptionalModuleId): OptionalModuleDef | undefined {
  return OPTIONAL_MODULES.find((m) => m.id === id);
}

export function moduleLabel(id: OptionalModuleId): string {
  return moduleDef(id)?.label ?? String(id);
}

/**
 * Factory default = exactly today's access. The Invoicing & Money module is
 * switched on and Sales Coordinator is granted it; nothing is written to disk
 * until a Manager actually saves, so enabling this system removes nobody's
 * access on the day it ships.
 */
export function defaultOptionalModulesConfig(): OptionalModulesConfig {
  return {
    version: 1,
    enabled: ["invoicing"],
    roles: { "Sales Coordinator": ["invoicing"] },
    users: {},
  };
}

function cleanGrantList(input: unknown): OptionalModuleId[] {
  if (!Array.isArray(input)) return [];
  const out: OptionalModuleId[] = [];
  for (const raw of input) {
    if (!isOptionalModuleId(raw)) continue;
    if (!out.includes(raw)) out.push(raw);
  }
  return out;
}

/**
 * Validates untrusted input (API body, hand-edited JSON file) and returns a
 * clean config. Unknown module ids, unknown roles, non-numeric user keys,
 * Manager entries and garbage input are all dropped rather than rejected —
 * the caller always gets a usable object back.
 */
export function sanitizeOptionalModules(input: unknown): OptionalModulesConfig {
  const source =
    input && typeof input === "object" && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const hasInstalledList = Array.isArray(source.installedAddons);
  const installedAddons: InstallerAddonId[] | undefined = hasInstalledList
    ? INSTALLER_ADDON_IDS.filter((id) => (source.installedAddons as unknown[]).includes(id))
    : undefined;

  const enabledRaw = Array.isArray(source.enabled) ? source.enabled : [];
  const enabled = OPTIONAL_MODULE_IDS.filter(
    (id) =>
      enabledRaw.includes(id) &&
      (!installedAddons || isOptionalModuleInstalled(id, { installedAddons })),
  );

  const roles: Record<string, OptionalModuleId[]> = {};
  const rolesRaw = source.roles;
  if (rolesRaw && typeof rolesRaw === "object" && !Array.isArray(rolesRaw)) {
    for (const [rawName, rawMods] of Object.entries(rolesRaw as Record<string, unknown>)) {
      const name = String(rawName ?? "").trim();
      // Manager is never stored: it is always allowed (lock-out protection).
      if (!name || name.length > 30 || name === MANAGER_ROLE) continue;
      const mods = cleanGrantList(rawMods);
      if (mods.length > 0) roles[name] = mods;
    }
  }

  const users: Record<string, OptionalModuleId[]> = {};
  const usersRaw = source.users;
  if (usersRaw && typeof usersRaw === "object" && !Array.isArray(usersRaw)) {
    for (const [rawId, rawMods] of Object.entries(usersRaw as Record<string, unknown>)) {
      // JSON object keys are always strings: keep only plain positive integers,
      // so "3", "03" and "abc" cannot become three different users.
      const key = String(rawId ?? "").trim();
      const num = Number(key);
      if (!/^\d+$/.test(key) || !Number.isSafeInteger(num) || num <= 0) continue;
      const mods = cleanGrantList(rawMods);
      if (mods.length > 0) users[String(num)] = mods;
    }
  }

  return installedAddons
    ? { version: 1, enabled, roles, users, installedAddons }
    : { version: 1, enabled, roles, users };
}

/** The role names a subject carries: the custom role first, then the base. */
function roleNamesOf(subject: ModuleSubject): string[] {
  if (!subject) return [];
  const out: string[] = [];
  for (const raw of [subject.displayRole, subject.role]) {
    const name = String(raw ?? "").trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * The resolution rule, in order:
 *   0. Hard installation lock: if the module's add-on pack was not selected
 *      during Windows installation, nobody has it (even Manager).
 *   1. Manager always keeps access to installed modules (lock-out protection).
 *   2. A module that is switched off is off for everybody else.
 *   3. A personal grant wins on its own.
 *   4. Otherwise a role grant — checked on the custom role name first, then on
 *      the built-in role it inherits from.
 */
export function subjectHasModule(
  id: OptionalModuleId,
  subject: ModuleSubject,
  cfg?: OptionalModulesConfig | null,
): boolean {
  if (!subject || !isOptionalModuleId(id)) return false;
  const config = cfg ?? defaultOptionalModulesConfig();

  // 0 — Hard installation lock (WoodTek-ERP-Setup.exe selection).
  if (!isOptionalModuleInstalled(id, config)) return false;

  // 1 — Manager is never locked out of installed modules.
  if (roleNamesOf(subject).includes(MANAGER_ROLE)) return true;

  // 2 — master switch.
  if (!config.enabled.includes(id)) return false;

  // 3 — personal grant.
  const userId = subject.id;
  if (userId != null && Number.isSafeInteger(Number(userId))) {
    const personal = config.users?.[String(Number(userId))];
    if (Array.isArray(personal) && personal.includes(id)) return true;
  }

  // 4 — role grant (custom role name counts).
  for (const name of roleNamesOf(subject)) {
    const granted = config.roles?.[name];
    if (Array.isArray(granted) && granted.includes(id)) return true;
  }

  return false;
}

/** Money visibility is decided by the grant, not by a hard-coded role list. */
export function canSeeMoney(
  subject: ModuleSubject,
  cfg?: OptionalModulesConfig | null,
): boolean {
  return subjectHasModule(MONEY_MODULE, subject, cfg);
}

/** Which optional module owns a sidebar screen, or null if none does. */
export function screenOwnerModule(screenId: string | null | undefined): OptionalModuleId | null {
  const wanted = String(screenId ?? "").trim();
  if (!wanted) return null;
  for (const id of OPTIONAL_MODULE_IDS) {
    if (OPTIONAL_MODULE_SCREENS[id].includes(wanted)) return id;
  }
  return null;
}

/**
 * True unless:
 *  - the screen belongs to an installer add-on pack (`invoicing`, `purchasing`,
 *    `cmms`, `workforce`) that was not installed on this PC, OR
 *  - the screen belongs to an optional module the subject lacks.
 */
export function screenAllowedForSubject(
  screenId: string | null | undefined,
  subject: ModuleSubject,
  cfg?: OptionalModulesConfig | null,
): boolean {
  if (!isScreenInstalled(screenId, cfg)) return false;
  const owner = screenOwnerModule(screenId);
  if (!owner) return true;
  return subjectHasModule(owner, subject, cfg);
}

function diffLists(
  before: OptionalModuleId[],
  after: OptionalModuleId[],
): { added: OptionalModuleId[]; removed: OptionalModuleId[] } {
  return {
    added: after.filter((id) => !before.includes(id)),
    removed: before.filter((id) => !after.includes(id)),
  };
}

/**
 * One plain-language line for the audit trail: what the Manager actually
 * changed. Deliberately counts a personal grant and a role grant separately so
 * the audit log can answer "who gave money to that person?".
 */
export function summarizeOptionalModuleChange(
  prev: OptionalModulesConfig,
  next: OptionalModulesConfig,
): string {
  const before = sanitizeOptionalModules(prev);
  const after = sanitizeOptionalModules(next);
  const parts: string[] = [];

  const master = diffLists(before.enabled, after.enabled);
  if (master.added.length > 0) parts.push(`switched on ${master.added.map(moduleLabel).join(", ")}`);
  if (master.removed.length > 0) parts.push(`switched off ${master.removed.map(moduleLabel).join(", ")}`);

  const names = new Set<string>([...Object.keys(before.roles), ...Object.keys(after.roles)]);
  for (const name of [...names].sort()) {
    const d = diffLists(before.roles[name] ?? [], after.roles[name] ?? []);
    if (d.added.length > 0) parts.push(`granted ${d.added.map(moduleLabel).join(", ")} to role ${name}`);
    if (d.removed.length > 0) parts.push(`removed ${d.removed.map(moduleLabel).join(", ")} from role ${name}`);
  }

  const ids = new Set<string>([...Object.keys(before.users), ...Object.keys(after.users)]);
  for (const uid of [...ids].sort((a, b) => Number(a) - Number(b))) {
    const d = diffLists(before.users[uid] ?? [], after.users[uid] ?? []);
    if (d.added.length > 0) parts.push(`granted ${d.added.map(moduleLabel).join(", ")} to user #${uid}`);
    if (d.removed.length > 0) parts.push(`removed ${d.removed.map(moduleLabel).join(", ")} from user #${uid}`);
  }

  if (parts.length === 0) return "Optional modules saved (no change)";
  return `Optional modules: ${parts.join("; ")}`;
}
