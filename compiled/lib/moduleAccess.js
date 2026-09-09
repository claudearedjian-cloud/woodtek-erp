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
exports.MODULES_BY_ROLE = void 0;
exports.canAccessModule = canAccessModule;
exports.listModulesForRole = listModulesForRole;
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
    ],
    "Sales Coordinator": [
        "dashboard",
        "orders",
        "customers",
        "schedule",
        "reports",
        "wip",
    ],
    // Shop-floor operators only see what they work with: their station,
    // quality (scrap & rework) and workforce/shifts. Everything else is
    // hidden from the sidebar AND blocked by the page-level guard.
    "Machine Operator": [
        "operator",
        "workforce",
        "quality",
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
    ],
    Technician: [
        "dashboard",
        "machines",
        "operator",
        "cmms",
        "workforce",
        "wip",
        "downtime",
    ],
};
function canAccessModule(role, module) {
    if (!role)
        return false;
    const modules = exports.MODULES_BY_ROLE[role] ?? [];
    return modules.includes(module);
}
function listModulesForRole(role) {
    if (!role)
        return [];
    return exports.MODULES_BY_ROLE[role] ?? [];
}
