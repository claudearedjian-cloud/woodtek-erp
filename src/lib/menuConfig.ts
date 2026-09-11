// ============================================================================
// Menu Designer — runtime menu configuration.
// Safe to import from client components AND server routes (no node imports).
// The Sidebar renders what resolveMenu() returns; the Menu Designer view
// edits a MenuConfig which is stored as JSON by /api/menu-config.
// ============================================================================

import { canAccessModule, type ModuleId } from "@/lib/moduleAccess";
import { allRoles, baseRoleOf } from "@/lib/permissions";

export type MenuGroup = "top" | "settings";

export interface MenuRegistryItem {
  id: string; // tab id used by page.tsx
  label: string; // default label
  badge: string; // default badge ("" = none)
  group: MenuGroup; // default placement
}

// Default menu (labels / badges / placement). Icons are zipped in by the
// Sidebar via the item id. Order here is the fallback order.
export const MENU_REGISTRY: MenuRegistryItem[] = [
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

export interface MenuConfigItem {
  id: string;
  label?: string;
  badge?: string;
  group?: MenuGroup;
  roles?: Record<string, boolean>; // per-role visibility overrides
}
export interface MenuConfig {
  version: 1;
  items: MenuConfigItem[];
}

export interface ResolvedMenuItem {
  id: string;
  label: string;
  badge: string;
}

const moduleFor = (id: string): ModuleId =>
  id === "station" ? "operator" : (id as ModuleId);

export function defaultVisibleFor(role: string, id: string): boolean {
  // canAccessModule resolves custom roles (explicit allowlist or base fallback).
  return canAccessModule(role, moduleFor(id));
}

// Merge defaults + stored config into an ordered, per-role menu.
export function resolveMenu(
  role: string | null | undefined,
  config: MenuConfig | null | undefined,
): { top: ResolvedMenuItem[]; settings: ResolvedMenuItem[] } {
  if (!role) return { top: [], settings: [] };
  const cfgItems = config?.items ?? [];
  const byId = new Map(cfgItems.map((i) => [i.id, i]));
  const known = (id: string) => MENU_REGISTRY.some((r) => r.id === id);
  const ordered = [
    ...cfgItems.map((i) => i.id).filter(known),
    ...MENU_REGISTRY.map((r) => r.id).filter((id) => !byId.has(id)),
  ];
  const canSeeSettings = canAccessModule(role, "settings");
  const top: ResolvedMenuItem[] = [];
  const settings: ResolvedMenuItem[] = [];
  for (const id of ordered) {
    const reg = MENU_REGISTRY.find((r) => r.id === id)!;
    const cfg = byId.get(id);
    const override = cfg?.roles ? cfg.roles[role] : undefined;
    const visible =
      typeof override === "boolean" ? override : defaultVisibleFor(role, id);
    if (!visible) continue;
    const item: ResolvedMenuItem = {
      id,
      label: (cfg?.label ?? reg.label).slice(0, 40),
      badge: (cfg?.badge ?? reg.badge).slice(0, 10),
    };
    let group: MenuGroup = cfg?.group ?? reg.group;
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
export function sanitizeMenuConfig(body: unknown): MenuConfig {
  const raw = body as { items?: unknown } | null;
  const src = Array.isArray(raw?.items) ? (raw!.items as unknown[]) : [];
  const seen = new Set<string>();
  const items: MenuConfigItem[] = [];
  for (const entry of src) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const id = String(e.id ?? "");
    if (!MENU_REGISTRY.some((r) => r.id === id) || seen.has(id)) continue;
    seen.add(id);
    const item: MenuConfigItem = { id };
    if (typeof e.label === "string" && e.label.trim()) {
      item.label = e.label.trim().slice(0, 40);
    }
    if (typeof e.badge === "string") item.badge = e.badge.trim().slice(0, 10);
    if (e.group === "settings" || e.group === "top") item.group = e.group;
    if (e.roles && typeof e.roles === "object") {
      const roles: Record<string, boolean> = {};
      for (const r of allRoles()) {
        const v = (e.roles as Record<string, unknown>)[r];
        if (typeof v === "boolean") roles[r] = v;
      }
      if (Object.keys(roles).length) item.roles = roles;
    }
    items.push(item);
  }
  return { version: 1, items };
}
