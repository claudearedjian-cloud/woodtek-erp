// ===========================================================================
// Menu Designer — pure row/section manipulation helpers.
// Kept separate from the React view so render-test can exercise every drag,
// section and save-payload rule without a browser. These functions never
// decide permissions: screen visibility still comes from
// canAccessModule()/defaultVisibleFor(); this module only arranges the one
// shared layout the designer edits.
// ===========================================================================

import {
  GROUP_MAX,
  MENU_REGISTRY,
  defaultVisibleFor,
  isCustomId,
  type MenuConfig,
  type MenuConfigItem,
} from "@/lib/menuConfig";
import { allRoles } from "@/lib/permissions";

export interface DesignerRow {
  id: string;
  label: string;
  badge: string;
  group: string; // "top" | "settings" | custom section name
  icon: string; // "" = automatic
  /** Audience is configurable only for external website links. */
  roles: Record<string, boolean>;
  custom?: boolean;
  kind?: "tab" | "link";
  target?: string;
}

export interface DesignerGroup {
  key: string;
  label: string;
  customSection: boolean;
  rows: DesignerRow[];
}

export function pickDesignerLanding(cfg: MenuConfig | null): Record<string, string> {
  const out: Record<string, string> = {};
  const roles = new Set(allRoles());
  for (const [k, v] of Object.entries(cfg?.landing ?? {})) {
    if (roles.has(k) && typeof v === "string") out[k] = v;
  }
  return out;
}

export function pickDesignerSectionIcons(cfg: MenuConfig | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(cfg?.sectionIcons ?? {})) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function buildDesignerRows(cfg: MenuConfig | null): DesignerRow[] {
  const byId = new Map((cfg?.items ?? []).map((i) => [i.id, i]));
  const known = (id: string) =>
    MENU_REGISTRY.some((r) => r.id === id) || isCustomId(id);
  const ordered = [
    ...(cfg?.items ?? []).map((i) => i.id).filter(known),
    ...MENU_REGISTRY.map((r) => r.id).filter((id) => !byId.has(id)),
  ];
  return ordered
    .filter((id) => id !== "designer")
    .map((id) => {
      const reg = MENU_REGISTRY.find((r) => r.id === id);
      const c = byId.get(id);
      const custom = isCustomId(id);
      const roles: Record<string, boolean> = {};
      if (custom && c?.kind === "link") {
        for (const r of allRoles()) {
          roles[r] = typeof c.roles?.[r] === "boolean" ? c.roles[r]! : defaultVisibleFor(r, id, c);
        }
      }
      return {
        id,
        label: c?.label ?? reg?.label ?? "New menu item",
        badge: c?.badge ?? reg?.badge ?? "",
        group: c?.group ?? reg?.group ?? "top",
        icon: typeof c?.icon === "string" ? c.icon : "",
        roles,
        custom,
        kind: c?.kind === "link" ? "link" : "tab",
        target: c?.target ?? "dashboard",
      };
    });
}

export function designerRowToMenuItem(row: DesignerRow): MenuConfigItem {
  return {
    id: row.id,
    label: row.custom ? row.label.trim() || "New menu item" : row.label,
    badge: row.badge,
    group: row.group,
    icon: row.icon || undefined,
    ...(row.custom && row.kind === "link" ? { roles: row.roles } : {}),
    ...(row.custom
      ? {
          custom: true as const,
          kind: row.kind === "link" ? ("link" as const) : ("tab" as const),
          target: row.target || "dashboard",
        }
      : {}),
  };
}

export function designerRowsToItems(rows: DesignerRow[]): MenuConfigItem[] {
  return rows.map(designerRowToMenuItem);
}

export function designerDraftConfig(
  rows: DesignerRow[],
  landing: Record<string, string>,
  sectionIcons: Record<string, string>,
): MenuConfig {
  return {
    version: 1,
    items: designerRowsToItems(rows),
    landing,
    sectionIcons,
  };
}

/** Custom section names, in the order the sidebar will show them. */
export function designerSectionNames(rows: DesignerRow[]): string[] {
  return Array.from(
    new Set(
      rows
        .map((r) => (r.group !== "top" && r.group !== "settings" ? r.group : ""))
        .filter(Boolean),
    ),
  );
}

/**
 * The editor displays rows bucketed by placement so dragging inside a bucket
 * means exactly what the sidebar will show for that bucket. Top and General
 * Settings are always present ( they are useful drop targets even when
 * empty); custom sections appear in first-use order, followed by any empty
 * staged sections the designer created during this editing session.
 */
export function groupDesignerRows(
  rows: DesignerRow[],
  extraSections: string[] = [],
): DesignerGroup[] {
  const names = designerSectionNames(rows);
  const groups: DesignerGroup[] = [
    {
      key: "top",
      label: "Top level",
      customSection: false,
      rows: rows.filter((r) => r.group === "top"),
    },
    {
      key: "settings",
      label: "Under General Settings",
      customSection: false,
      rows: rows.filter((r) => r.group === "settings"),
    },
    ...names.map((name) => ({
      key: name,
      label: name,
      customSection: true,
      rows: rows.filter((r) => r.group === name),
    })),
  ];
  for (const name of extraSections) {
    const clean = name.trim().slice(0, GROUP_MAX);
    if (!clean || clean === "top" || clean === "settings") continue;
    if (groups.some((g) => g.key.toLowerCase() === clean.toLowerCase())) continue;
    groups.push({ key: clean, label: clean, customSection: true, rows: [] });
  }
  return groups;
}

/**
 * Moves one row to a destination placement. `beforeId` is the row it should
 * land in front of; null means the end of that placement. The row adopts the
 * destination placement, which is what makes drag-between-sections work.
 */
export function moveDesignerRowTo(
  rows: DesignerRow[],
  draggedId: string,
  destinationGroup: string,
  beforeId: string | null,
): DesignerRow[] {
  const from = rows.findIndex((r) => r.id === draggedId);
  if (from < 0 || draggedId === beforeId) return rows;
  const next = [...rows];
  const [dragged] = next.splice(from, 1);
  const moved = { ...dragged, group: destinationGroup };

  if (beforeId) {
    const at = next.findIndex((r) => r.id === beforeId);
    if (at >= 0) {
      next.splice(at, 0, moved);
      return next;
    }
  }

  let lastInGroup = -1;
  next.forEach((r, i) => {
    if (r.group === destinationGroup) lastInGroup = i;
  });
  next.splice(lastInGroup >= 0 ? lastInGroup + 1 : next.length, 0, moved);
  return next;
}

/** Arrow-button move: swaps with the neighbour inside the same placement. */
export function moveDesignerRowWithinGroup(
  rows: DesignerRow[],
  id: string,
  direction: -1 | 1,
): DesignerRow[] {
  const row = rows.find((r) => r.id === id);
  if (!row) return rows;
  const groupRows = rows.filter((r) => r.group === row.group);
  const at = groupRows.findIndex((r) => r.id === id);
  const swapWith = at + direction;
  if (at < 0 || swapWith < 0 || swapWith >= groupRows.length) return rows;
  const reordered = [...groupRows];
  [reordered[at], reordered[swapWith]] = [reordered[swapWith], reordered[at]];
  let cursor = 0;
  return rows.map((r) => (r.group === row.group ? reordered[cursor++] : r));
}

/**
 * Reorders custom sections. resolveMenu() derives section order from the
 * first row that uses each section, so moving a section moves its first
 * appearance across the neighbouring section while keeping every row's
 * relative order inside its own section.
 */
export function moveDesignerSection(
  rows: DesignerRow[],
  sectionName: string,
  direction: -1 | 1,
): DesignerRow[] {
  const names = designerSectionNames(rows);
  const at = names.indexOf(sectionName);
  const otherAt = at + direction;
  if (at < 0 || otherAt < 0 || otherAt >= names.length) return rows;
  const other = names[otherAt];
  const moving = rows.filter((r) => r.group === sectionName);
  const rest = rows.filter((r) => r.group !== sectionName);
  const otherFirst = rest.findIndex((r) => r.group === other);
  if (otherFirst < 0) return rows;
  const insertAt = direction < 0 ? otherFirst : otherFirst + 1;
  return [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];
}

export function cleanSectionName(value: string): string {
  return value.trim().slice(0, GROUP_MAX);
}

export function renameDesignerSection(
  rows: DesignerRow[],
  oldName: string,
  rawNewName: string,
): DesignerRow[] {
  const nextName = cleanSectionName(rawNewName);
  if (!nextName || nextName === "top" || nextName === "settings" || nextName === oldName) return rows;
  const conflict = designerSectionNames(rows).some(
    (name) => name !== oldName && name.toLowerCase() === nextName.toLowerCase(),
  );
  if (conflict) return rows;
  return rows.map((r) => (r.group === oldName ? { ...r, group: nextName } : r));
}

export function clearDesignerSection(rows: DesignerRow[], sectionName: string): DesignerRow[] {
  return rows.map((r) => (r.group === sectionName ? { ...r, group: "top" } : r));
}

export function designerRowMatches(row: DesignerRow, rawQuery: string): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;
  return [row.label, row.id, row.group, row.target ?? "", row.badge]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

/**
 * Roles expected to see this entry under the menu/access-profile rule. This
 * is explanatory UI only; Sidebar additionally applies installed optional
 * module switches, and server routes remain the real authorization boundary.
 */
export function visibleRolesForDesignerRow(row: DesignerRow): string[] {
  const item = designerRowToMenuItem(row);
  return allRoles().filter((role) => defaultVisibleFor(role, row.id, item));
}
