"use client";

// ============================================================================
// Cards / List / Table view switch — one shared control for every screen that
// shows a set of records. The choice is remembered per device (localStorage),
// exactly like the auto-lock timer and the language, so a warehouse PC stays
// on Table while the manager's laptop stays on Cards.
// ============================================================================

import { useEffect, useState } from "react";
import { LayoutGrid, List, Rows3, Table2 } from "lucide-react";

export type ViewMode = "cards" | "list" | "table";

export const VIEW_MODE_STORAGE_PREFIX = "woodtek-view-";

export const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  cards: "Cards",
  list: "List",
  table: "Table",
};

/** Mirrors the mode options of the screens that need a custom label set. */
export const DEFAULT_VIEW_MODES: ViewMode[] = ["cards", "list", "table"];

function normalizeViewMode(value: unknown, fallback: ViewMode): ViewMode {
  return value === "cards" || value === "list" || value === "table" ? value : fallback;
}

/** Read the remembered mode for a screen (device-local, best effort). */
export function loadViewMode(key: string, fallback: ViewMode = "cards"): ViewMode {
  try {
    return normalizeViewMode(localStorage.getItem(VIEW_MODE_STORAGE_PREFIX + key), fallback);
  } catch {
    return fallback;
  }
}

export function saveViewMode(key: string, mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_MODE_STORAGE_PREFIX + key, mode);
  } catch {
    /* private mode — the choice simply is not remembered */
  }
}

/**
 * Remembered view mode for one screen. `key` is the screen's storage key
 * (e.g. "clients"); the default is used on the server and on first visit.
 */
export function useViewMode(key: string, fallback: ViewMode = "cards"): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(fallback);
  useEffect(() => {
    setMode(loadViewMode(key, fallback));
    // The key is stable per screen; the fallback is a constant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const change = (next: ViewMode) => {
    const clean = normalizeViewMode(next, fallback);
    setMode(clean);
    saveViewMode(key, clean);
  };
  return [mode, change];
}

const ICONS: Record<ViewMode, typeof LayoutGrid> = {
  cards: LayoutGrid,
  list: List,
  table: Table2,
};

/**
 * The control itself. Renders nothing when fewer than two modes are offered,
 * so a screen can keep it mounted while a filter hides the alternatives.
 */
export default function ViewToggle({
  mode,
  onChange,
  options = DEFAULT_VIEW_MODES,
  title = "How this list is shown",
  labels,
}: {
  mode: ViewMode;
  onChange: (mode: ViewMode) => void;
  options?: ViewMode[];
  title?: string;
  /** Screens with their own vocabulary (a BOM "Board", a stock "Table"). */
  labels?: Partial<Record<ViewMode, string>>;
}) {
  if (options.length < 2) return null;
  const labelOf = (option: ViewMode) => labels?.[option] ?? VIEW_MODE_LABELS[option];
  return (
    <div
      className="inline-flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950/70 p-1"
      title={title}
      role="group"
      aria-label={title}
    >
      {options.map((option) => {
        const Icon = option === "list" ? Rows3 : ICONS[option];
        const active = mode === option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={active}
            title={`${labelOf(option)} view`}
            className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-black transition ${
              active
                ? "bg-amber-500 text-slate-950 shadow"
                : "text-slate-400 hover:bg-slate-800 hover:text-white"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{labelOf(option)}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Small summary line that every filtered screen shows ("Showing X of Y"). */
export function ResultCount({
  shown,
  total,
  noun,
  filtered,
}: {
  shown: number;
  total: number;
  noun: string;
  filtered: boolean;
}) {
  return (
    <span className="text-[11px] font-bold text-slate-400">
      Showing {shown} of {total} {noun}
      {total === 1 ? "" : "s"}
      {filtered ? " (filtered)" : ""}
    </span>
  );
}
