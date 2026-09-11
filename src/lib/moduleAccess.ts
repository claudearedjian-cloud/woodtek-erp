// src/lib/moduleAccess.ts
// ============================================================================
// Per-role visibility for top-level modules.
//
// A "module" corresponds to one sidebar tab. The Sidebar component reads
// this map to decide which tabs to render, and the page-level guard uses
// it to redirect a user who manually types an unreachable URL.
// ============================================================================

import type { Role } from "@/lib/dataAccess";
import { getCustomRoles, getModuleOverrides } from "@/lib/permissions";

export type ModuleId =
  | "dashboard"
  | "orders"
  | "machines"
  | "operator"
  | "customers"
  | "inventory"
  | "schedule"
  | "gantt"
  | "cmms"
  | "reports"
  | "settings"
  | "workforce"
  | "wip"
  | "quality"
  | "downtime"
  | "recipes"
  | "pims"
  | "designer"
  | "warehouse"
  | "plant"
  | "reception";

/**
 * Every module a role is allowed to access. Manager sees all. Other roles
 * see only the modules they need for their day-to-day work.
 */
export const MODULES_BY_ROLE: Record<Role, ModuleId[]> = {
  Manager: [
    "dashboard",
    "orders",
    "machines",
    "operator",
    "customers",
    "inventory",
    "schedule",
    "gantt",
    "cmms",
    "reports",
    "settings",
    "workforce",
    "wip",
    "quality",
    "downtime",
    "recipes",
    "pims",
    "designer",
    "warehouse",
    "plant",
    "reception",
  ],
  "Sales Coordinator": [
    "dashboard",
    "orders",
    "customers",
    "schedule",
    "reports",
    "wip",
    "plant",
  ],
  // Shop-floor operators only see what they work with: their station,
  // quality (scrap & rework) and workforce/shifts. Everything else is
  // hidden from the sidebar AND blocked by the page-level guard.
  "Machine Operator": [
    "operator",
    "workforce",
    "quality",
  ],
  // Floor Supervisor patrols the shop: stations, WIP, warehouse/reception,
  // quality and downtime — but no commercial screens.
  "Floor Supervisor": [
    "reception",
    "dashboard",
    "orders",
    "operator",
    "wip",
    "warehouse",
    "inventory",
    "quality",
    "downtime",
    "workforce",
    "plant",
  ],
  "QA & Dispatch": [
    "dashboard",
    "orders",
    "machines",
    "inventory",
    "cmms",
    "workforce",
    "wip",
    "quality",
    "downtime",
    "warehouse",
    "plant",
  ],
  Technician: [
    "dashboard",
    "machines",
    "operator",
    "cmms",
    "workforce",
    "wip",
    "downtime",
    "plant",
  ],
};

/** Human labels for every module (role editor UI). */
export const MODULE_LABELS: Record<ModuleId, string> = {
  dashboard: "Executive Dashboard",
  orders: "Orders & Routing",
  machines: "Shop Floor Monitor",
  operator: "Operator Station",
  customers: "Clients & Architects",
  inventory: "Wood & Edge Stock",
  schedule: "Dispatch Schedule",
  gantt: "Gantt Chart",
  cmms: "Asset CMMS",
  reports: "System Reports",
  settings: "General Settings",
  workforce: "Workforce & Shifts",
  wip: "Live WIP Board",
  quality: "Scrap & Rework",
  downtime: "Downtime Log",
  recipes: "Routing Recipes",
  pims: "PIMS Import",
  warehouse: "Warehouse & BOM",
  designer: "Menu Designer",
  plant: "Plant Performance",
  reception: "Material Reception",
};

/**
 * Resolves a role's module visibility. A custom role with an explicit
 * `modules` allowlist sees EXACTLY those screens; otherwise it inherits its
 * base role's full list.
 */
export function canAccessModule(role: Role | string | null | undefined, module: ModuleId): boolean {
  if (!role) return false;
  const custom = getCustomRoles().find((r) => r.name === role);
  if (custom?.modules && custom.modules.length > 0) return custom.modules.includes(module);
  // Manager-saved screen override for this exact role name wins over defaults.
  const overrides = getModuleOverrides();
  const own = overrides[role as string];
  if (own && own.length > 0) return own.includes(module);
  const key = custom ? custom.base : (role as string);
  const baseOwn = custom ? overrides[custom.base] : undefined;
  if (baseOwn && baseOwn.length > 0) return baseOwn.includes(module);
  return ((MODULES_BY_ROLE as Record<string, ModuleId[]>)[key] ?? []).includes(module);
}

export function listModulesForRole(role: Role | string | null | undefined): ModuleId[] {
  if (!role) return [];
  const custom = getCustomRoles().find((r) => r.name === role);
  if (custom?.modules && custom.modules.length > 0) return custom.modules as ModuleId[];
  const overrides = getModuleOverrides();
  const own = overrides[role as string];
  if (own && own.length > 0) return own as ModuleId[];
  const key = custom ? custom.base : (role as string);
  const baseOwn = custom ? overrides[custom.base] : undefined;
  if (baseOwn && baseOwn.length > 0) return baseOwn as ModuleId[];
  return (MODULES_BY_ROLE as Record<string, ModuleId[]>)[key] ?? [];
}
