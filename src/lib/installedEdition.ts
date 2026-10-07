// ============================================================================
// Installed Edition — hard module lock set by the Windows .exe installer
// ============================================================================
//
// During initial Windows installation (WoodTek-ERP-Setup.exe), Core Production
// & Stock is always installed and the owner ticks which optional add-on packs
// to install on that PC:
//   - invoicing   (Invoicing, Job Costing & Money)
//   - purchasing  (Purchasing & Suppliers, incl. Supplier Bills & A/P)
//   - cmms        (Asset CMMS — Generators, Power & Preventative Maintenance)
//   - workforce   (Workforce, Shifts & HR / Payroll)
//
// Any add-on NOT selected during installation is hard-locked on that PC:
//   1. Its sidebar screens are hidden for every role (including Manager).
//   2. Its API routes return 403 (cannot be bypassed by URL or direct fetch).
//   3. It cannot be switched on from Settings > Optional modules.
//   4. Re-running WoodTek-ERP-Setup.exe is the only way to add/remove packs.
//
// Backward compatibility: when data/installed-edition.json does not exist on
// disk (e.g. an existing factory PC before the installer was introduced), all
// four add-on packs default to installed ("Full Edition").
// ============================================================================

export type InstallerAddonId = "invoicing" | "purchasing" | "cmms" | "workforce";

export const INSTALLER_ADDON_IDS: readonly InstallerAddonId[] = [
  "invoicing",
  "purchasing",
  "cmms",
  "workforce",
] as const;

export interface InstallerAddonDef {
  id: InstallerAddonId;
  label: string;
  shortLabel: string;
  description: string;
  screens: readonly string[];
  optionalModuleIds: readonly ("invoicing" | "purchasing" | "payroll")[];
}

export const CORE_EDITION_SUMMARY = {
  id: "core" as const,
  label: "Core Production & Stock",
  description:
    "Orders & Routing, Shop Floor Monitor, Operator Station, Live WIP, Material Reception, Warehouse, Inventory, Dispatch Schedule, Gantt Chart, Production Report, Clients & Architects, Scrap & Rework, Downtime Log, Routing Recipes, PIMS Import, Plant Performance, System Reports, Menu Designer & Settings.",
};

export const INSTALLER_ADDONS: readonly InstallerAddonDef[] = [
  {
    id: "invoicing",
    label: "Invoicing, Job Costing & Money",
    shortLabel: "Invoicing & Money",
    description:
      "VAT quotations & invoices (11%), client payments, A/R aging, Job Costing & Profit, and financial columns across orders, stock, customers and reports.",
    screens: ["invoicing", "jobcosting"],
    optionalModuleIds: ["invoicing"],
  },
  {
    id: "purchasing",
    label: "Purchasing & Suppliers",
    shortLabel: "Purchasing",
    description:
      "Supplier directory, purchase orders, goods receipts (GRN) that increment stock, low-stock PO creation, and Supplier Bills & A/P aging.",
    screens: ["purchasing"],
    optionalModuleIds: ["purchasing"],
  },
  {
    id: "cmms",
    label: "Asset CMMS (Maintenance & Generators)",
    shortLabel: "Asset CMMS",
    description:
      "Plant asset registry, generator power & fuel telemetry, preventative maintenance logs, and overdue service alerts.",
    screens: ["cmms"],
    optionalModuleIds: [],
  },
  {
    id: "workforce",
    label: "Workforce, Shifts & HR",
    shortLabel: "Workforce & HR",
    description:
      "Shift definitions, production shift calendar, operator time & attendance clock-in/out, plus the optional HR & Payroll workspace.",
    screens: ["workforce", "hr"],
    optionalModuleIds: ["payroll"],
  },
] as const;

export interface InstalledEditionConfig {
  version: 1;
  /** Add-on packs selected when WoodTek-ERP-Setup.exe was run on this PC. */
  addons: InstallerAddonId[];
  installedAt?: string;
  installerVersion?: string;
}

export type EditionSource =
  | InstalledEditionConfig
  | { installedAddons?: readonly string[] | null; addons?: readonly string[] | null }
  | readonly string[]
  | null
  | undefined;

export function isInstallerAddonId(value: unknown): value is InstallerAddonId {
  return typeof value === "string" && (INSTALLER_ADDON_IDS as readonly string[]).includes(value);
}

export function addonDef(id: InstallerAddonId): InstallerAddonDef | undefined {
  return INSTALLER_ADDONS.find((a) => a.id === id);
}

export function addonLabel(id: InstallerAddonId): string {
  return addonDef(id)?.label ?? String(id);
}

/**
 * Default when no data/installed-edition.json file exists on disk:
 * all add-on packs are installed (Full Edition), preserving existing behavior.
 */
export function defaultInstalledEdition(): InstalledEditionConfig {
  return {
    version: 1,
    addons: [...INSTALLER_ADDON_IDS],
  };
}

/**
 * Sanitizes an installed-edition JSON payload.
 * - If input is null/undefined or lacks an `addons` array, falls back to the
 *   Full Edition default so missing/corrupt files never brick an existing PC.
 * - An explicit empty `addons: []` array is preserved (Core-only installation).
 */
export function sanitizeInstalledEdition(input: unknown): InstalledEditionConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return defaultInstalledEdition();
  }
  const src = input as Record<string, unknown>;
  if (!Array.isArray(src.addons)) {
    return defaultInstalledEdition();
  }
  const rawList = src.addons;
  const addons = INSTALLER_ADDON_IDS.filter((id) => rawList.includes(id));
  const out: InstalledEditionConfig = { version: 1, addons };
  if (typeof src.installedAt === "string" && src.installedAt.trim()) {
    out.installedAt = src.installedAt.trim().slice(0, 64);
  }
  if (typeof src.installerVersion === "string" && src.installerVersion.trim()) {
    out.installerVersion = src.installerVersion.trim().slice(0, 32);
  }
  return out;
}

/**
 * Extracts the active InstallerAddonId list from an InstalledEditionConfig,
 * an OptionalModulesConfig (via `installedAddons`), or a raw string array.
 * When no explicit list is present, defaults to all 4 add-ons installed.
 */
export function resolveInstalledAddons(source?: EditionSource): InstallerAddonId[] {
  if (!source) return [...INSTALLER_ADDON_IDS];
  if (Array.isArray(source)) {
    return INSTALLER_ADDON_IDS.filter((id) => source.includes(id));
  }
  const obj = source as { installedAddons?: readonly string[] | null; addons?: readonly string[] | null };
  if (Array.isArray(obj.installedAddons)) {
    return INSTALLER_ADDON_IDS.filter((id) => obj.installedAddons!.includes(id));
  }
  if (Array.isArray(obj.addons)) {
    return INSTALLER_ADDON_IDS.filter((id) => obj.addons!.includes(id));
  }
  return [...INSTALLER_ADDON_IDS];
}

export function isAddonInstalled(id: InstallerAddonId, source?: EditionSource): boolean {
  if (!isInstallerAddonId(id)) return false;
  return resolveInstalledAddons(source).includes(id);
}

/** Which installer add-on pack owns a sidebar screen, or null for Core screens. */
export function screenOwnerAddon(screenId: string | null | undefined): InstallerAddonId | null {
  const wanted = String(screenId ?? "").trim();
  if (!wanted) return null;
  for (const addon of INSTALLER_ADDONS) {
    if (addon.screens.includes(wanted)) return addon.id;
  }
  return null;
}

/** True unless the screen belongs to an add-on pack that was not installed. */
export function isScreenInstalled(
  screenId: string | null | undefined,
  source?: EditionSource,
): boolean {
  const owner = screenOwnerAddon(screenId);
  if (!owner) return true;
  return isAddonInstalled(owner, source);
}

/** Maps an OptionalModuleId ("invoicing" | "purchasing" | "payroll") to its installer add-on pack. */
export function optionalModuleAddon(
  modId: "invoicing" | "purchasing" | "payroll" | string,
): InstallerAddonId | null {
  if (modId === "invoicing") return "invoicing";
  if (modId === "purchasing") return "purchasing";
  if (modId === "payroll") return "workforce";
  return null;
}

/** True unless the optional module's add-on pack was omitted during installation. */
export function isOptionalModuleInstalled(
  modId: "invoicing" | "purchasing" | "payroll" | string,
  source?: EditionSource,
): boolean {
  const addon = optionalModuleAddon(modId);
  if (!addon) return false;
  return isAddonInstalled(addon, source);
}

/** Maps a permission action to an installer add-on pack when that action is exclusive to an add-on. */
export function actionOwnerAddon(action: string | null | undefined): InstallerAddonId | null {
  const act = String(action ?? "").trim();
  if (!act) return null;
  if (act.startsWith("cmms:")) return "cmms";
  if (act.startsWith("shifts:") || act.startsWith("attendance:")) return "workforce";
  return null;
}

/** True unless the permission action belongs to an uninstalled add-on pack. */
export function isActionInstalled(
  action: string | null | undefined,
  source?: EditionSource,
): boolean {
  const addon = actionOwnerAddon(action);
  if (!addon) return true;
  return isAddonInstalled(addon, source);
}
