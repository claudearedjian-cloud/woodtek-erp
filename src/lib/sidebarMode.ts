// ============================================================================
// Left menu (sidebar) behaviour on desktop. Chosen per device and kept in
// localStorage, so every screen follows it.
//
//   keep      - the menu is always visible beside the screen (the old behaviour)
//   autohide  - the menu slides away; it opens when the mouse reaches the left
//               edge or the menu button is pressed, and closes when the mouse
//               leaves it
//   hide      - the menu stays closed until the menu button is pressed; it
//               closes again after a choice or a click outside it
//
// On phones the menu is always a drawer, whatever this setting is.
// ============================================================================

export type SidebarMode = "keep" | "autohide" | "hide";

export const SIDEBAR_MODES: readonly SidebarMode[] = ["keep", "autohide", "hide"];

export const SIDEBAR_MODE_LABELS: Record<SidebarMode, string> = {
  keep: "Keep",
  autohide: "Auto-hide",
  hide: "Hide",
};

export const SIDEBAR_MODE_HINTS: Record<SidebarMode, string> = {
  keep: "Always visible beside the screen",
  autohide: "Opens at the left edge or with the menu button; closes when the mouse leaves",
  hide: "Closed until the menu button is pressed",
};

export const SIDEBAR_MODE_KEY = "woodtek-sidebar-mode";

export function normalizeSidebarMode(value: unknown): SidebarMode {
  return SIDEBAR_MODES.includes(value as SidebarMode) ? (value as SidebarMode) : "keep";
}

/** Reads the device choice; "keep" when nothing is stored or storage is unavailable. */
export function readSidebarMode(): SidebarMode {
  try {
    return normalizeSidebarMode(globalThis.localStorage?.getItem(SIDEBAR_MODE_KEY));
  } catch {
    return "keep";
  }
}

export function writeSidebarMode(mode: SidebarMode): void {
  try {
    globalThis.localStorage?.setItem(SIDEBAR_MODE_KEY, mode);
  } catch {
    /* the choice applies for this session only */
  }
}

/** Classes for the desktop sidebar panel. Phones always use the drawer classes. */
export function sidebarDesktopClasses(mode: SidebarMode, isOpen: boolean): string {
  if (mode === "keep") return "md:relative md:translate-x-0";
  return `md:fixed md:inset-y-0 md:left-0 ${isOpen ? "md:translate-x-0 md:shadow-2xl" : "md:-translate-x-full"}`;
}
