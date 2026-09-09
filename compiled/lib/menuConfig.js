"use strict";
// ============================================================================
// Menu Designer — runtime menu configuration.
// Safe to import from client components AND server routes (no node imports).
// The Sidebar renders what resolveMenu() returns; the Menu Designer view
// edits a MenuConfig which is stored as JSON by /api/menu-config.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.MENU_REGISTRY = void 0;
exports.defaultVisibleFor = defaultVisibleFor;
exports.resolveMenu = resolveMenu;
exports.sanitizeMenuConfig = sanitizeMenuConfig;
const moduleAccess_1 = require("../lib/moduleAccess");
const permissions_1 = require("../lib/permissions");
// Default menu (labels / badges / placement). Icons are zipped in by the
// Sidebar via the item id. Order here is the fallback order.
exports.MENU_REGISTRY = [
    { id: "dashboard", label: "Executive Dashboard", badge: "", group: "top" },
    { id: "wip", label: "Live WIP Board", badge: "Live", group: "top" },
    { id: "plant", label: "Plant Performance", badge: "OEE", group: "top" },
    { id: "orders", label: "Orders & Routing", badge: "Live", group: "top" },
    { id: "recipes", label: "Routing Recipes", badge: "Recipe", group: "settings" },
    { id: "schedule", label: "Dispatch Schedule", badge: "Plan", group: "top" },
    { id: "gantt", label: "Gantt Chart", badge: "Timeline", group: "top" },
    { id: "machines", label: "Shop Floor Monitor", badge: "", group: "settings" },
    { id: "cmms", label: "Asset CMMS", badge: "PM", group: "top" },
    { id: "downtime", label: "Downtime Log", badge: "Down", group: "settings" },
    { id: "quality", label: "Scrap & Rework", badge: "QA", group: "top" },
    { id: "workforce", label: "Workforce & Shifts", badge: "Shift", group: "settings" },
    { id: "station", label: "Operator Station Mode", badge: "Touch", group: "top" },
    { id: "customers", label: "Clients & Architects", badge: "", group: "top" },
    { id: "warehouse", label: "Warehouse & BOM", badge: "BOM", group: "top" },
    { id: "inventory", label: "Wood & Edge Stock", badge: "", group: "settings" },
    { id: "pims", label: "PIMS Import", badge: "Link", group: "settings" },
    { id: "reports", label: "System Reports", badge: "PDF", group: "top" },
    { id: "settings", label: "General Settings", badge: "", group: "top" },
    { id: "designer", label: "Menu Designer", badge: "UI", group: "top" },
];
const moduleFor = (id) => id === "station" ? "operator" : id;
function defaultVisibleFor(role, id) {
    // canAccessModule resolves custom roles (explicit allowlist or base fallback).
    return (0, moduleAccess_1.canAccessModule)(role, moduleFor(id));
}
// Merge defaults + stored config into an ordered, per-role menu.
function resolveMenu(role, config) {
    if (!role)
        return { top: [], settings: [] };
    const cfgItems = config?.items ?? [];
    const byId = new Map(cfgItems.map((i) => [i.id, i]));
    const known = (id) => exports.MENU_REGISTRY.some((r) => r.id === id);
    const ordered = [
        ...cfgItems.map((i) => i.id).filter(known),
        ...exports.MENU_REGISTRY.map((r) => r.id).filter((id) => !byId.has(id)),
    ];
    const canSeeSettings = (0, moduleAccess_1.canAccessModule)(role, "settings");
    const top = [];
    const settings = [];
    for (const id of ordered) {
        const reg = exports.MENU_REGISTRY.find((r) => r.id === id);
        const cfg = byId.get(id);
        const override = cfg?.roles ? cfg.roles[role] : undefined;
        const visible = typeof override === "boolean" ? override : defaultVisibleFor(role, id);
        if (!visible)
            continue;
        const item = {
            id,
            label: (cfg?.label ?? reg.label).slice(0, 40),
            badge: (cfg?.badge ?? reg.badge).slice(0, 10),
        };
        let group = cfg?.group ?? reg.group;
        // Roles that cannot open General Settings get grouped items promoted,
        // and the settings entry itself always sits at top level.
        if (group === "settings" && (!canSeeSettings || id === "settings")) {
            group = "top";
        }
        (group === "settings" ? settings : top).push(item);
    }
    return { top, settings };
}
// Server-side sanitisation for PUT bodies: drop unknown ids, clamp strings,
// validate roles/groups, keep the given order.
function sanitizeMenuConfig(body) {
    const raw = body;
    const src = Array.isArray(raw?.items) ? raw.items : [];
    const seen = new Set();
    const items = [];
    for (const entry of src) {
        if (!entry || typeof entry !== "object")
            continue;
        const e = entry;
        const id = String(e.id ?? "");
        if (!exports.MENU_REGISTRY.some((r) => r.id === id) || seen.has(id))
            continue;
        seen.add(id);
        const item = { id };
        if (typeof e.label === "string" && e.label.trim()) {
            item.label = e.label.trim().slice(0, 40);
        }
        if (typeof e.badge === "string")
            item.badge = e.badge.trim().slice(0, 10);
        if (e.group === "settings" || e.group === "top")
            item.group = e.group;
        if (e.roles && typeof e.roles === "object") {
            const roles = {};
            for (const r of (0, permissions_1.allRoles)()) {
                const v = e.roles[r];
                if (typeof v === "boolean")
                    roles[r] = v;
            }
            if (Object.keys(roles).length)
                item.roles = roles;
        }
        items.push(item);
    }
    return { version: 1, items };
}
