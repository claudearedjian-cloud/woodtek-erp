"use strict";
// src/lib/moduleAccess.ts
// ============================================================================
// Per-role visibility for top-level modules.
//
// A "module" corresponds to one sidebar tab. The Sidebar component reads
// this map to decide which tabs to render, and the page-level guard uses
// it to redirect a user who manually types an unreachable URL.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODULE_LABELS = exports.MODULES_BY_ROLE = void 0;
exports.canAccessModule = canAccessModule;
exports.listModulesForRole = listModulesForRole;
const permissions_1 = require("../lib/permissions");
/**
 * Every module a role is allowed to access. Manager sees all. Other roles
 * see only the modules they need for their day-to-day work.
 */
exports.MODULES_BY_ROLE = {
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
exports.MODULE_LABELS = {
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
};
/**
 * Resolves a role's module visibility. A custom role with an explicit
 * `modules` allowlist sees EXACTLY those screens; otherwise it inherits its
 * base role's full list.
 */
function canAccessModule(role, module) {
    if (!role)
        return false;
    const custom = (0, permissions_1.getCustomRoles)().find((r) => r.name === role);
    if (custom?.modules && custom.modules.length > 0)
        return custom.modules.includes(module);
    const key = custom ? custom.base : role;
    return (exports.MODULES_BY_ROLE[key] ?? []).includes(module);
}
function listModulesForRole(role) {
    if (!role)
        return [];
    const custom = (0, permissions_1.getCustomRoles)().find((r) => r.name === role);
    if (custom?.modules && custom.modules.length > 0)
        return custom.modules;
    const key = custom ? custom.base : role;
    return exports.MODULES_BY_ROLE[key] ?? [];
}
