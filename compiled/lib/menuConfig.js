"use strict";
// ============================================================================
// Menu Designer — runtime menu configuration.
// Safe to import from client components AND server routes (no node imports).
// The Sidebar renders what resolveMenu() returns; the Menu Designer view
// edits a MenuConfig which is stored as JSON by /api/menu-config.
// ============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCustomId = exports.MENU_REGISTRY = exports.GROUP_MAX = exports.BADGE_MAX = exports.LABEL_MAX = void 0;
exports.defaultVisibleFor = defaultVisibleFor;
exports.resolveMenu = resolveMenu;
exports.sanitizeMenuConfig = sanitizeMenuConfig;
const moduleAccess_1 = require("../lib/moduleAccess");
const permissions_1 = require("../lib/permissions");
// Display limits (raised 2026-09-14 at the owner's request: was 40/10).
exports.LABEL_MAX = 60;
exports.BADGE_MAX = 20;
exports.GROUP_MAX = 30;
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
    { id: "reception", label: "Material Reception", badge: "RX", group: "top" },
    { id: "inventory", label: "Wood & Edge Stock", badge: "", group: "settings" },
    { id: "pims", label: "PIMS Import", badge: "Link", group: "settings" },
    { id: "reports", label: "System Reports", badge: "PDF", group: "top" },
    { id: "settings", label: "General Settings", badge: "", group: "top" },
    { id: "designer", label: "Menu Designer", badge: "UI", group: "top" },
];
const moduleFor = (id) => id === "station" ? "operator" : id;
// Designer-created ids live in the custom-<base36> namespace.
const isCustomId = (id) => typeof id === "string" && id.startsWith("custom-");
exports.isCustomId = isCustomId;
function defaultVisibleFor(role, id) {
    // Designer-created items start visible to the Manager only; every other
    // role must be ticked explicitly in the Menu Designer.
    if ((0, exports.isCustomId)(id))
        return role === "Manager";
    // canAccessModule resolves custom roles (explicit allowlist or base fallback).
    return (0, moduleAccess_1.canAccessModule)(role, moduleFor(id));
}
// "top"/"settings" keep their special meaning; any other non-empty string is
// a custom section name. Empty/unknown -> "top".
const normalizeGroup = (g) => {
    const s = typeof g === "string" ? g.trim().slice(0, exports.GROUP_MAX) : "";
    return s || "top";
};
const isHttpUrl = (s) => {
    try {
        const u = new URL(s);
        return u.protocol === "http:" || u.protocol === "https:";
    }
    catch {
        return false;
    }
};
// Defense-in-depth: even a hand-edited menu-config.json can never hand the
// Sidebar anything but a clean http(s) link or a known tab id.
const safeCustomNav = (cfg) => {
    const target = (cfg?.target || "dashboard").trim();
    if (cfg?.kind === "link" && isHttpUrl(target)) {
        return { kind: "link", target };
    }
    return {
        kind: "tab",
        target: exports.MENU_REGISTRY.some((r) => r.id === target) ? target : "dashboard",
    };
};
// Merge defaults + stored config into an ordered, per-role menu. Custom
// sections come back in first-appearance order.
function resolveMenu(role, config) {
    if (!role)
        return { top: [], settings: [], sections: [] };
    const cfgItems = config?.items ?? [];
    const byId = new Map(cfgItems.map((i) => [i.id, i]));
    const known = (id) => exports.MENU_REGISTRY.some((r) => r.id === id) || (0, exports.isCustomId)(id);
    const ordered = [
        ...cfgItems.map((i) => i.id).filter(known),
        ...exports.MENU_REGISTRY.map((r) => r.id).filter((id) => !byId.has(id)),
    ];
    const canSeeSettings = (0, moduleAccess_1.canAccessModule)(role, "settings");
    const top = [];
    const settings = [];
    const sections = [];
    const sectionByName = new Map();
    for (const id of ordered) {
        const reg = exports.MENU_REGISTRY.find((r) => r.id === id);
        const cfg = byId.get(id);
        const override = cfg?.roles ? cfg.roles[role] : undefined;
        const visible = typeof override === "boolean" ? override : defaultVisibleFor(role, id);
        if (!visible)
            continue;
        const item = {
            id,
            label: (cfg?.label ?? reg?.label ?? "New menu item").slice(0, exports.LABEL_MAX),
            badge: (cfg?.badge ?? reg?.badge ?? "").slice(0, exports.BADGE_MAX),
        };
        if ((0, exports.isCustomId)(id)) {
            const nav = safeCustomNav(cfg);
            item.kind = nav.kind;
            item.target = nav.target;
        }
        let group = normalizeGroup(cfg?.group ?? reg?.group ?? "top");
        if (group === "top" || group === "settings") {
            // Roles that cannot open General Settings get grouped items promoted,
            // and the settings entry itself always sits at top level.
            if (group === "settings" && (!canSeeSettings || id === "settings")) {
                group = "top";
            }
            (group === "settings" ? settings : top).push(item);
        }
        else {
            // Custom named section, created by the Menu Designer.
            let sec = sectionByName.get(group);
            if (!sec) {
                sec = { name: group, items: [] };
                sectionByName.set(group, sec);
                sections.push(sec);
            }
            sec.items.push(item);
        }
    }
    return { top, settings, sections };
}
// Server-side sanitisation for PUT bodies: drop unknown ids, clamp strings,
// validate roles/groups/targets, keep the given order.
const CUSTOM_ID_RE = /^custom-[a-z0-9-]{1,40}$/;
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
        const registryItem = exports.MENU_REGISTRY.some((r) => r.id === id);
        const customItem = !registryItem && CUSTOM_ID_RE.test(id);
        if ((!registryItem && !customItem) || seen.has(id))
            continue;
        seen.add(id);
        const item = { id };
        if (typeof e.label === "string" && e.label.trim()) {
            item.label = e.label.trim().slice(0, exports.LABEL_MAX);
        }
        else if (customItem) {
            item.label = "New menu item";
        }
        if (typeof e.badge === "string")
            item.badge = e.badge.trim().slice(0, exports.BADGE_MAX);
        if (typeof e.group === "string" && e.group.trim()) {
            item.group = e.group.trim().slice(0, exports.GROUP_MAX);
        }
        if (customItem) {
            item.custom = true;
            const target = typeof e.target === "string" ? e.target.trim() : "";
            if (e.kind === "link" && isHttpUrl(target)) {
                item.kind = "link";
                item.target = target.slice(0, 500);
            }
            else {
                // Anything that is not a clean http(s) URL collapses to a safe tab.
                item.kind = "tab";
                item.target = exports.MENU_REGISTRY.some((r) => r.id === target)
                    ? target
                    : "dashboard";
            }
        }
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
