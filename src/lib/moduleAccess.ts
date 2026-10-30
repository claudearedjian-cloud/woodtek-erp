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
  | "purchasing"
  | "invoicing"
  | "jobcosting"
  | "schedule"
  | "gantt"
  | "production"
  | "cmms"
  | "reports"
  | "settings"
  | "workforce"
  | "hr"
  | "wip"
  | "quality"
  | "downtime"
  | "recipes"
  | "pims"
  | "designer"
  | "design"
  | "warehouse"
  | "plant"
  | "assembly"
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
    "purchasing",
    "invoicing",
    "jobcosting",
    "schedule",
    "gantt",
    "production",
    "cmms",
    "reports",
    "settings",
    "workforce",
    "hr",
    "wip",
    "quality",
    "downtime",
    "recipes",
    "pims",
    "designer",
    "design",
    "warehouse",
    "plant",
    "assembly",
    "reception",
  ],
  "Sales Coordinator": [
    "dashboard",
    "orders",
    "customers",
    "invoicing",
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
    "assembly",
  ],
  // Warehouse Supervisor lives in the warehouse: fulfilment board + stock.
  "Warehouse Supervisor": [
    "warehouse",
    "inventory",
    "workforce",
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
    "assembly",
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
  inventory: "Inventory",
  purchasing: "Purchasing & Suppliers",
  invoicing: "Invoicing & A/R",
  jobcosting: "Job Costing & Profit",
  schedule: "Dispatch Schedule",
  gantt: "Gantt Chart",
  production: "Production Report",
  cmms: "Asset CMMS",
  reports: "System Reports",
  settings: "General Settings",
  workforce: "Workforce & Shifts",
  hr: "HR & Payroll",
  wip: "Live WIP Board",
  quality: "Scrap & Rework",
  downtime: "Downtime Log",
  recipes: "Routing Recipes",
  pims: "PIMS Import",
  warehouse: "Warehouse",
  designer: "Menu Designer",
  design: "Design Department",
  plant: "Plant Performance",
  reception: "Material Reception",
  assembly: "Cabinet Assembly",
};

/**
 * Resolves a role's module visibility. A custom role with an explicit
 * `modules` allowlist sees EXACTLY those screens; otherwise it inherits its
 * base role's full list.
 */
export function canAccessModule(role: Role | string | null | undefined, module: ModuleId): boolean {
  if (!role) return false;
  const custom = getCustomRoles().find((r) => r.name === role);
  const overrides = getModuleOverrides();

  // An explicit screen allowlist on a custom profile (or a saved profile-level
  // override) is authoritative for navigation, including optional screens.
  // The optional-module grant is still checked separately by the sidebar/page
  // and, critically, by authorizeModule() on every API route.
  if (custom?.modules && custom.modules.length > 0) return custom.modules.includes(module);
  const own = overrides[role];
  if (own && own.length > 0) return own.includes(module);
  const key = custom ? custom.base : role;
  const baseOwn = custom ? overrides[custom.base] : undefined;
  if (baseOwn && baseOwn.length > 0) return baseOwn.includes(module);

  // Optional modules are granted separately from the built-in screen defaults.
  // If a profile has no explicit screen allowlist, a role/module grant can add
  // its screen; the required module grant remains an independent gate.
  if (module === "purchasing" || module === "invoicing" || module === "jobcosting" || module === "hr" || module === "design") {
    return Boolean(custom || Object.hasOwn(MODULES_BY_ROLE, role));
  }
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
