"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  Globe,
  GripVertical,
  Layers,
  Pencil,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import Sidebar from "@/components/Sidebar";
import {
  BADGE_MAX,
  GROUP_MAX,
  LABEL_MAX,
  MENU_REGISTRY,
  type MenuConfig,
} from "@/lib/menuConfig";
import {
  buildDesignerRows,
  cleanSectionName,
  clearDesignerSection,
  designerDraftConfig,
  designerRowMatches,
  designerSectionNames,
  groupDesignerRows,
  moveDesignerRowTo,
  moveDesignerRowWithinGroup,
  moveDesignerSection,
  pickDesignerLanding,
  pickDesignerSectionIcons,
  renameDesignerSection,
  visibleRolesForDesignerRow,
  type DesignerGroup,
  type DesignerRow,
} from "@/lib/menuDesigner";
import { MENU_ICON_CHOICES, iconChoice } from "@/lib/menuIcons";
import { listModulesForRole } from "@/lib/moduleAccess";
import type { OptionalModulesConfig } from "@/lib/optionalModules";
import { allRoles, baseRoleOf, registerCustomRoles } from "@/lib/permissions";

interface Props {
  currentUser: any;
  menuConfig: MenuConfig | null;
  optionalModulesConfig?: OptionalModulesConfig | null;
  onSaved: (c: MenuConfig | null) => void;
}

interface EditorSnapshot {
  rows: DesignerRow[];
  landing: Record<string, string>;
  sectionIcons: Record<string, string>;
}

type IconPickerTarget =
  | { kind: "row"; id: string; label: string }
  | { kind: "section"; name: string };

interface DropTarget {
  group: string;
  rowId: string | null;
  after: boolean;
}

const NEW_GROUP = "__new-section__";
const HISTORY_LIMIT = 60;
const COALESCE_MS = 900;

function cloneSnapshot(snapshot: EditorSnapshot): EditorSnapshot {
  return JSON.parse(JSON.stringify(snapshot)) as EditorSnapshot;
}

function snapshotFromConfig(cfg: MenuConfig | null): EditorSnapshot {
  return {
    rows: buildDesignerRows(cfg),
    landing: pickDesignerLanding(cfg),
    sectionIcons: pickDesignerSectionIcons(cfg),
  };
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function sameSnapshot(a: EditorSnapshot, b: EditorSnapshot): boolean {
  return stableStringify(a) === stableStringify(b);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function IconGalleryModal({
  title,
  value,
  autoLabel,
  onPick,
  onClose,
}: {
  title: string;
  value: string;
  autoLabel: string;
  onPick: (icon: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const choices = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MENU_ICON_CHOICES;
    return MENU_ICON_CHOICES.filter((choice) =>
      `${choice.label} ${choice.key}`.toLowerCase().includes(q),
    );
  }, [query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/75 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-amber-500/30 bg-slate-900 shadow-2xl">
        <div className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-sm font-extrabold text-white">Choose an icon</h3>
            <p className="truncate text-xs text-slate-400">{title}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-700 bg-slate-950 p-2 text-slate-300 transition hover:bg-slate-800 hover:text-white"
            aria-label="Close icon gallery"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="border-b border-slate-800 px-4 py-3">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search icons by name..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm font-semibold text-white outline-none focus:border-amber-500/60"
            />
          </label>
        </div>
        <div className="custom-scrollbar overflow-y-auto p-4">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            <button
              type="button"
              onClick={() => onPick("")}
              aria-pressed={value === ""}
              className={`relative flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-center transition ${
                value === ""
                  ? "border-amber-400 bg-amber-500/15 text-amber-300"
                  : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-600 hover:text-white"
              }`}
            >
              {value === "" && <Check className="absolute right-2 top-2 h-3.5 w-3.5" />}
              <Layers className="h-5 w-5" />
              <span className="text-[11px] font-bold leading-tight">{autoLabel}</span>
            </button>
            {choices.map((choice) => {
              const Icon = choice.Icon;
              const selected = value === choice.key;
              return (
                <button
                  key={choice.key}
                  type="button"
                  onClick={() => onPick(choice.key)}
                  aria-pressed={selected}
                  title={`${choice.label} (${choice.key})`}
                  className={`relative flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border px-2 py-3 text-center transition ${
                    selected
                      ? "border-amber-400 bg-amber-500/15 text-amber-300"
                      : "border-slate-800 bg-slate-950/60 text-slate-300 hover:border-slate-600 hover:text-white"
                  }`}
                >
                  {selected && <Check className="absolute right-2 top-2 h-3.5 w-3.5" />}
                  <Icon className="h-5 w-5" />
                  <span className="text-[11px] font-bold leading-tight">{choice.label}</span>
                </button>
              );
            })}
          </div>
          {choices.length === 0 && (
            <p className="py-8 text-center text-sm font-semibold text-slate-400">
              No icons match that search.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MenuDesignerView({
  currentUser,
  menuConfig,
  optionalModulesConfig,
  onSaved,
}: Props) {
  const [baseline, setBaseline] = useState<EditorSnapshot>(() => snapshotFromConfig(menuConfig));
  const [rows, setRows] = useState<DesignerRow[]>(() => cloneSnapshot(baseline).rows);
  const [landing, setLanding] = useState<Record<string, string>>(() => cloneSnapshot(baseline).landing);
  const [sectionIcons, setSectionIcons] = useState<Record<string, string>>(
    () => cloneSnapshot(baseline).sectionIcons,
  );
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [stagedSections, setStagedSections] = useState<string[]>([]);
  const [newSectionName, setNewSectionName] = useState("");
  const [renamingSection, setRenamingSection] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [iconTarget, setIconTarget] = useState<IconPickerTarget | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [previewRole, setPreviewRole] = useState(
    () => currentUser?.displayRole || currentUser?.role || "Manager",
  );
  const [, setRolesVersion] = useState(0);
  const [, setHistoryVersion] = useState(0);

  const currentSnapshot = useMemo<EditorSnapshot>(
    () => ({ rows, landing, sectionIcons }),
    [landing, rows, sectionIcons],
  );
  const currentSnapshotRef = useRef<EditorSnapshot>(currentSnapshot);
  const baselineRef = useRef<EditorSnapshot>(baseline);
  const previousSnapshotRef = useRef<EditorSnapshot>(cloneSnapshot(currentSnapshot));
  const undoRef = useRef<EditorSnapshot[]>([]);
  const redoRef = useRef<EditorSnapshot[]>([]);
  const applyingHistoryRef = useRef(false);
  const pendingCoalesceRef = useRef<string | null>(null);
  const lastHistoryRef = useRef<{ key: string; at: number } | null>(null);

  useEffect(() => {
    currentSnapshotRef.current = currentSnapshot;
  }, [currentSnapshot]);

  useEffect(() => {
    baselineRef.current = baseline;
  }, [baseline]);

  useEffect(() => {
    const previous = previousSnapshotRef.current;
    if (sameSnapshot(previous, currentSnapshot)) {
      pendingCoalesceRef.current = null;
      return;
    }
    if (applyingHistoryRef.current) {
      applyingHistoryRef.current = false;
      previousSnapshotRef.current = cloneSnapshot(currentSnapshot);
      pendingCoalesceRef.current = null;
      return;
    }

    const key = pendingCoalesceRef.current ?? "";
    const now = Date.now();
    const coalesce =
      !!key && lastHistoryRef.current?.key === key && now - lastHistoryRef.current.at < COALESCE_MS;
    if (!coalesce) {
      undoRef.current = [
        ...undoRef.current.slice(-(HISTORY_LIMIT - 1)),
        cloneSnapshot(previous),
      ];
    }
    redoRef.current = [];
    lastHistoryRef.current = { key, at: now };
    pendingCoalesceRef.current = null;
    previousSnapshotRef.current = cloneSnapshot(currentSnapshot);
    setHistoryVersion((version) => version + 1);
  }, [currentSnapshot]);

  const dirty = !sameSnapshot(currentSnapshot, baseline);
  const canUndo = undoRef.current.length > 0;
  const canRedo = redoRef.current.length > 0;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const roles = allRoles();
  const draftConfig = useMemo(
    () => designerDraftConfig(rows, landing, sectionIcons),
    [landing, rows, sectionIcons],
  );
  const sectionNames = designerSectionNames(rows);
  const groups = groupDesignerRows(rows, stagedSections);
  const searchActive = search.trim().length > 0;
  const normalizedSearch = search.trim().toLowerCase();
  const displayGroups: DesignerGroup[] = groups
    .map((group) => {
      if (!searchActive) return group;
      const groupMatches = group.label.toLowerCase().includes(normalizedSearch);
      return {
        ...group,
        rows: groupMatches ? group.rows : group.rows.filter((row) => designerRowMatches(row, search)),
      };
    })
    .filter((group) => !searchActive || group.rows.length > 0);
  const matchCount = displayGroups.reduce((sum, group) => sum + group.rows.length, 0);
  const previewUser = {
    name: "Preview",
    role: baseRoleOf(previewRole) || previewRole,
    displayRole: previewRole,
  };

  const resetHistory = (snapshot: EditorSnapshot) => {
    undoRef.current = [];
    redoRef.current = [];
    applyingHistoryRef.current = false;
    pendingCoalesceRef.current = null;
    lastHistoryRef.current = null;
    previousSnapshotRef.current = cloneSnapshot(snapshot);
    setHistoryVersion((version) => version + 1);
  };

  const replaceSnapshot = (
    snapshot: EditorSnapshot,
    options: { makeBaseline?: boolean; clearHistory?: boolean } = {},
  ) => {
    const next = cloneSnapshot(snapshot);
    setRows(next.rows);
    setLanding(next.landing);
    setSectionIcons(next.sectionIcons);
    currentSnapshotRef.current = next;
    if (options.makeBaseline) {
      const cleanBaseline = cloneSnapshot(next);
      setBaseline(cleanBaseline);
      baselineRef.current = cleanBaseline;
    }
    if (options.makeBaseline || options.clearHistory) resetHistory(next);
  };

  // Pick up custom roles so their landing, audience and preview choices appear.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/roles", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : { roles: [] }))
      .then((data) => {
        if (cancelled) return;
        registerCustomRoles(Array.isArray(data.roles) ? data.roles : []);
        setRolesVersion((version) => version + 1);
        const fresh = snapshotFromConfig(menuConfig);
        // Do not erase typing if the roles request returns after editing starts.
        if (sameSnapshot(currentSnapshotRef.current, baselineRef.current)) {
          replaceSnapshot(fresh, { makeBaseline: true });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const markEdit = (coalesceKey?: string) => {
    pendingCoalesceRef.current = coalesceKey ?? null;
    if (status) setStatus("");
  };

  const applyRows = (nextRows: DesignerRow[], coalesceKey?: string) => {
    markEdit(coalesceKey);
    setRows(nextRows);
  };

  const patchRow = (id: string, patch: Partial<DesignerRow>, coalesceKey?: string) => {
    applyRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)), coalesceKey);
  };

  const applyHistorySnapshot = (snapshot: EditorSnapshot) => {
    applyingHistoryRef.current = true;
    lastHistoryRef.current = null;
    replaceSnapshot(snapshot);
    setIconTarget(null);
    setRenamingSection(null);
    setDraggedId(null);
    setDropTarget(null);
  };

  const undo = () => {
    const previous = undoRef.current.pop();
    if (!previous) return;
    redoRef.current.push(cloneSnapshot(currentSnapshotRef.current));
    setHistoryVersion((version) => version + 1);
    applyHistorySnapshot(previous);
    setStatus("Undo applied. Save when the preview looks right.");
  };

  const redo = () => {
    const next = redoRef.current.pop();
    if (!next) return;
    undoRef.current.push(cloneSnapshot(currentSnapshotRef.current));
    setHistoryVersion((version) => version + 1);
    applyHistorySnapshot(next);
    setStatus("Redo applied. Save when the preview looks right.");
  };

  const discardChanges = () => {
    if (!dirty || busy) return;
    if (!window.confirm("Discard every unsaved Menu Designer change and return to the last saved layout?")) return;
    replaceSnapshot(baselineRef.current, { clearHistory: true });
    setStagedSections([]);
    setIconTarget(null);
    setRenamingSection(null);
    setDraggedId(null);
    setDropTarget(null);
    setStatus("Unsaved changes discarded. The last saved layout is unchanged.");
  };

  const addItem = (groupKey = "top") => {
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    const newRow: DesignerRow = {
      id,
      label: "New menu item",
      badge: "",
      group: groupKey,
      icon: "",
      roles: Object.fromEntries(roles.map((role) => [role, role === "Manager"])),
      custom: true,
      kind: "tab",
      target: "dashboard",
    };
    setSearch("");
    applyRows(moveDesignerRowTo([newRow, ...rows], id, groupKey, null));
    setStatus("New item added. Name it and choose a screen or website. Screen access follows Access Profiles.");
  };

  const removeRow = (row: DesignerRow) => {
    applyRows(rows.filter((entry) => entry.id !== row.id));
    if (iconTarget?.kind === "row" && iconTarget.id === row.id) setIconTarget(null);
    setStatus(`Removed "${row.label}". Undo can bring it back before you save.`);
  };

  const landingChoices = (role: string) => {
    const ids = Array.from(
      new Set(
        listModulesForRole(role)
          .map((moduleId) => (moduleId === "operator" ? "station" : moduleId))
          .filter((id) => MENU_REGISTRY.some((entry) => entry.id === id)),
      ),
    );
    return ids.map((id) => ({
      id,
      label: rows.find((row) => row.id === id)?.label ?? MENU_REGISTRY.find((entry) => entry.id === id)?.label ?? id,
    }));
  };

  const setLandingFor = (role: string, tab: string) => {
    markEdit();
    setLanding((previous) => {
      const next = { ...previous };
      if (tab) next[role] = tab;
      else delete next[role];
      return next;
    });
  };

  const setSectionIcon = (name: string, icon: string) => {
    markEdit();
    setSectionIcons((previous) => {
      const next = { ...previous };
      if (icon) next[name] = icon;
      else delete next[name];
      return next;
    });
  };

  const moveRowToGroup = (row: DesignerRow, destination: string) => {
    const groupsForLookup = groupDesignerRows(rows, stagedSections);
    const existing = groupsForLookup.find(
      (group) => group.key.toLowerCase() === destination.toLowerCase(),
    );
    applyRows(moveDesignerRowTo(rows, row.id, existing?.key ?? destination, null));
  };

  const chooseGroup = (row: DesignerRow, value: string) => {
    if (value !== NEW_GROUP) {
      moveRowToGroup(row, value);
      return;
    }
    const raw = window.prompt(
      "Name of the new section. It will show as a header in the sidebar (max " + GROUP_MAX + " characters):",
    );
    const name = cleanSectionName(raw ?? "");
    if (!name) return;
    if (name.toLowerCase() === "top") {
      moveRowToGroup(row, "top");
      return;
    }
    if (name.toLowerCase() === "settings") {
      moveRowToGroup(row, "settings");
      return;
    }
    const existing = groups.find((group) => group.key.toLowerCase() === name.toLowerCase());
    moveRowToGroup(row, existing?.key ?? name);
    setStatus(
      existing
        ? `Item moved into the existing section "${existing.key}".`
        : `New section "${name}" created. Drag more items into it, then Save.`,
    );
  };

  const addSection = () => {
    const name = cleanSectionName(newSectionName);
    if (!name) {
      setStatus("Error: type a section name first.");
      return;
    }
    if (name.toLowerCase() === "top" || name.toLowerCase() === "settings") {
      setStatus("Error: Top level and General Settings are built-in placements. Choose another section name.");
      return;
    }
    const existing = groups.find((group) => group.key.toLowerCase() === name.toLowerCase());
    if (existing) {
      setStatus(`Error: the section "${existing.key}" already exists.`);
      return;
    }
    setStagedSections((previous) => [...previous, name]);
    setNewSectionName("");
    setStatus(`Section "${name}" is ready. Drag an item into it. Empty staged sections are not saved.`);
  };

  const beginRenameSection = (group: DesignerGroup) => {
    setRenamingSection(group.key);
    setRenameValue(group.key);
  };

  const cancelRenameSection = () => {
    setRenamingSection(null);
    setRenameValue("");
  };

  const commitRenameSection = (group: DesignerGroup) => {
    const nextName = cleanSectionName(renameValue);
    if (!nextName) {
      setStatus("Error: a section name cannot be blank.");
      return;
    }
    if (nextName.toLowerCase() === "top" || nextName.toLowerCase() === "settings") {
      setStatus("Error: that name is reserved for a built-in placement.");
      return;
    }
    const conflict = groups.some(
      (entry) => entry.key !== group.key && entry.key.toLowerCase() === nextName.toLowerCase(),
    );
    if (conflict) {
      setStatus(`Error: another section is already named "${nextName}".`);
      return;
    }
    if (nextName === group.key) {
      cancelRenameSection();
      return;
    }

    markEdit();
    if (group.rows.length > 0) {
      setRows(renameDesignerSection(rows, group.key, nextName));
    }
    setStagedSections((previous) => previous.map((name) => (name === group.key ? nextName : name)));
    setSectionIcons((previous) => {
      if (!previous[group.key]) return previous;
      const next = { ...previous, [nextName]: previous[group.key] };
      delete next[group.key];
      return next;
    });
    if (iconTarget?.kind === "section" && iconTarget.name === group.key) {
      setIconTarget({ kind: "section", name: nextName });
    }
    cancelRenameSection();
    setStatus(`Section renamed to "${nextName}".`);
  };

  const deleteSection = (group: DesignerGroup) => {
    if (group.rows.length > 0) {
      const confirmed = window.confirm(
        `Remove the section "${group.key}"? Its ${group.rows.length} item${group.rows.length === 1 ? "" : "s"} will move to Top level. No screen access changes.`,
      );
      if (!confirmed) return;
      markEdit();
      setRows(clearDesignerSection(rows, group.key));
    }
    setSectionIcons((previous) => {
      if (!previous[group.key]) return previous;
      const next = { ...previous };
      delete next[group.key];
      return next;
    });
    setStagedSections((previous) => previous.filter((name) => name !== group.key));
    if (renamingSection === group.key) cancelRenameSection();
    if (iconTarget?.kind === "section" && iconTarget.name === group.key) setIconTarget(null);
    setStatus(
      group.rows.length > 0
        ? `Section "${group.key}" removed and its items moved to Top level.`
        : `Empty section "${group.key}" removed.`,
    );
  };

  const pickIcon = (icon: string) => {
    if (!iconTarget) return;
    if (iconTarget.kind === "row") patchRow(iconTarget.id, { icon });
    else setSectionIcon(iconTarget.name, icon);
    setIconTarget(null);
  };

  const iconValueForTarget = () => {
    if (!iconTarget) return "";
    if (iconTarget.kind === "section") return sectionIcons[iconTarget.name] ?? "";
    return rows.find((row) => row.id === iconTarget.id)?.icon ?? "";
  };

  const iconTitleForTarget = () => {
    if (!iconTarget) return "";
    return iconTarget.kind === "row" ? iconTarget.label : `Section: ${iconTarget.name}`;
  };

  const startDrag = (event: React.DragEvent<HTMLElement>, row: DesignerRow) => {
    if (busy || searchActive) {
      event.preventDefault();
      return;
    }
    setDraggedId(row.id);
    setDropTarget(null);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", row.id);
  };

  const finishDrag = () => {
    setDraggedId(null);
    setDropTarget(null);
  };

  const handleRowDragOver = (
    event: React.DragEvent<HTMLElement>,
    groupKey: string,
    row: DesignerRow,
  ) => {
    if (!draggedId || draggedId === row.id || busy || searchActive) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    setDropTarget({ group: groupKey, rowId: row.id, after });
  };

  const dropOnRow = (
    event: React.DragEvent<HTMLElement>,
    groupKey: string,
    row: DesignerRow,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const dragged = draggedId || event.dataTransfer.getData("text/plain");
    if (!dragged || dragged === row.id) {
      finishDrag();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    let beforeId: string | null = row.id;
    if (after) {
      const groupRows = rows.filter((entry) => entry.group === groupKey);
      const targetIndex = groupRows.findIndex((entry) => entry.id === row.id);
      beforeId = groupRows.slice(targetIndex + 1).find((entry) => entry.id !== dragged)?.id ?? null;
    }
    applyRows(moveDesignerRowTo(rows, dragged, groupKey, beforeId));
    finishDrag();
  };

  const handleGroupDragOver = (event: React.DragEvent<HTMLElement>, groupKey: string) => {
    if (!draggedId || busy || searchActive) return;
    if ((event.target as HTMLElement).closest("[data-menu-designer-row='true']")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget({ group: groupKey, rowId: null, after: true });
  };

  const dropOnGroup = (event: React.DragEvent<HTMLElement>, groupKey: string) => {
    if ((event.target as HTMLElement).closest("[data-menu-designer-row='true']")) return;
    event.preventDefault();
    const dragged = draggedId || event.dataTransfer.getData("text/plain");
    if (!dragged) {
      finishDrag();
      return;
    }
    applyRows(moveDesignerRowTo(rows, dragged, groupKey, null));
    finishDrag();
  };

  const changeCustomKind = (row: DesignerRow, nextKind: "tab" | "link") => {
    patchRow(row.id, {
      kind: nextKind,
      target:
        nextKind === "link"
          ? ""
          : MENU_REGISTRY.some((entry) => entry.id === row.target)
            ? row.target
            : "dashboard",
      ...(nextKind === "link" && row.kind !== "link"
        ? { roles: Object.fromEntries(roles.map((role) => [role, role === "Manager"])) }
        : {}),
    });
  };

  const save = async () => {
    if (busy) return;
    const invalidLink = rows.find(
      (row) => row.custom && row.kind === "link" && !isHttpUrl((row.target ?? "").trim()),
    );
    if (invalidLink) {
      setStatus(`Error: "${invalidLink.label}" needs a full http:// or https:// website address before saving.`);
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/menu-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draftConfig),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Save failed");
      const savedConfig = (data.config ?? draftConfig) as MenuConfig;
      onSaved(savedConfig);
      replaceSnapshot(snapshotFromConfig(savedConfig), { makeBaseline: true });
      setStagedSections([]);
      setIconTarget(null);
      setRenamingSection(null);
      finishDrag();
      setStatus("Saved. The sidebar updates immediately on every device.");
    } catch (error: any) {
      setStatus("Error: " + (error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const resetDefaults = async () => {
    if (busy) return;
    const confirmed = window.confirm(
      "Reset the saved sidebar layout to the factory defaults now? This applies to every device immediately. Access Profiles and user permissions do not change.",
    );
    if (!confirmed) return;

    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/menu-config", { method: "DELETE" });
      if (!response.ok) throw new Error((await response.json()).error || "Reset failed");
      onSaved(null);
      replaceSnapshot(snapshotFromConfig(null), { makeBaseline: true });
      setStagedSections([]);
      setIconTarget(null);
      setRenamingSection(null);
      finishDrag();
      setStatus("Reset to factory defaults.");
    } catch (error: any) {
      setStatus("Error: " + (error?.message || error));
    } finally {
      setBusy(false);
    }
  };

  const buttonClass =
    "flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-45";
  const smallIconButtonClass =
    "rounded-lg border border-slate-700 bg-slate-950 p-1.5 text-slate-300 transition hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-35";

  return (
    <div className="mx-auto w-full max-w-[1680px] space-y-5 p-4 md:p-6">
      <div className="rounded-2xl border border-amber-500/30 bg-slate-900/70 p-5">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/20">
            <SlidersHorizontal className="h-5 w-5 text-amber-400" />
          </div>
          <div className="min-w-[260px] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-extrabold tracking-tight text-white">Menu Designer</h2>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${
                  dirty
                    ? "border-amber-500/50 bg-amber-500/15 text-amber-300"
                    : "border-slate-700 bg-slate-950/60 text-slate-400"
                }`}
              >
                {dirty ? "Unsaved changes" : "No unsaved changes"}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
              One shared sidebar layout for everyone: drag items into place, manage sections, choose icons,
              and preview the draft exactly as each role will see it. Access Profiles and server permissions
              still decide which screens a person may open. Only external website shortcuts have a menu audience.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => addItem("top")}
              disabled={busy}
              className={`${buttonClass} border-sky-500/40 bg-sky-500/15 text-sky-300 hover:bg-sky-500/25`}
            >
              <Plus className="h-3.5 w-3.5" /> Add menu item
            </button>
            <button
              type="button"
              onClick={undo}
              disabled={busy || !canUndo}
              className={`${buttonClass} border-slate-700 bg-slate-950/60 text-slate-200 hover:bg-slate-800`}
              title="Undo the last designer change"
            >
              <Undo2 className="h-3.5 w-3.5" /> Undo
            </button>
            <button
              type="button"
              onClick={redo}
              disabled={busy || !canRedo}
              className={`${buttonClass} border-slate-700 bg-slate-950/60 text-slate-200 hover:bg-slate-800`}
              title="Redo the change you just undid"
            >
              <Redo2 className="h-3.5 w-3.5" /> Redo
            </button>
            <button
              type="button"
              onClick={() => setShowPreview((visible) => !visible)}
              className={`${buttonClass} border-slate-700 bg-slate-950/60 text-slate-200 hover:bg-slate-800`}
            >
              {showPreview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showPreview ? "Hide preview" : "Show preview"}
            </button>
            <button
              type="button"
              onClick={discardChanges}
              disabled={busy || !dirty}
              className={`${buttonClass} border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20`}
            >
              <X className="h-3.5 w-3.5" /> Discard changes
            </button>
            <button
              type="button"
              onClick={resetDefaults}
              disabled={busy}
              className={`${buttonClass} border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 hover:text-white`}
            >
              <RotateCcw className="h-3.5 w-3.5" /> Reset defaults
            </button>
            <button
              type="button"
              onClick={save}
              disabled={busy || !dirty}
              className={`${buttonClass} border-amber-500/60 bg-gradient-to-r from-amber-500 to-amber-600 px-4 font-black text-slate-950 shadow-lg shadow-amber-950/40`}
            >
              <Save className="h-3.5 w-3.5" /> {busy ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>
        {status && (
          <div className={`mt-3 text-xs font-bold ${status.startsWith("Error") ? "text-rose-400" : "text-emerald-400"}`}>
            {status}
          </div>
        )}
      </div>

      <div className={showPreview ? "grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_350px]" : ""}>
        {showPreview && (
          <aside className="overflow-hidden rounded-2xl border border-sky-500/30 bg-slate-900/70 xl:order-2 xl:sticky xl:top-4">
            <div className="border-b border-slate-800 p-4">
              <div className="flex items-center gap-2">
                <Eye className="h-4 w-4 text-sky-300" />
                <h3 className="text-sm font-extrabold tracking-tight text-white">Live sidebar preview</h3>
              </div>
              <label className="mt-3 block text-[11px] font-bold uppercase tracking-wider text-slate-400">
                Preview as role
                <select
                  value={previewRole}
                  onChange={(event) => setPreviewRole(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-bold normal-case tracking-normal text-slate-100 outline-none focus:border-sky-500/60"
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                Draft only. The preview applies Access Profiles, custom roles, external-link audiences,
                and installed optional-module switches. Its buttons and links do not navigate.
              </p>
            </div>
            <div className="h-[640px] max-h-[calc(100vh-2rem)] min-h-[500px] bg-slate-950">
              <Sidebar
                activeTab={landing[previewRole] || "dashboard"}
                setActiveTab={() => {}}
                currentUser={previewUser}
                menuConfig={draftConfig}
                optionalModulesConfig={optionalModulesConfig}
                isOpen
                onClose={() => {}}
                mode="keep"
                preview
              />
            </div>
          </aside>
        )}

        <div className={`min-w-0 space-y-5 ${showPreview ? "xl:order-1" : ""}`}>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search menu items, screens, sections, badges..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2.5 pl-9 pr-9 text-sm font-semibold text-white outline-none focus:border-amber-500/60"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white"
                    aria-label="Clear designer search"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </label>
              <div className="flex gap-2">
                <input
                  value={newSectionName}
                  maxLength={GROUP_MAX}
                  onChange={(event) => setNewSectionName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") addSection();
                  }}
                  placeholder="New section name"
                  className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:border-amber-500/60"
                />
                <button
                  type="button"
                  onClick={addSection}
                  disabled={busy}
                  className={`${buttonClass} shrink-0 border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25`}
                >
                  <Plus className="h-3.5 w-3.5" /> Add section
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] font-semibold text-slate-400">
              <span>{searchActive ? `${matchCount} matching item${matchCount === 1 ? "" : "s"}` : `${rows.length} menu items in ${groups.length} placements`}</span>
              <span>Drag by the handle to reorder or move between placements.</span>
              {searchActive && <span className="text-amber-300">Drag is paused while searching; arrows still work.</span>}
            </div>
          </div>

          {displayGroups.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/50 p-8 text-center text-sm font-semibold text-slate-400">
              No menu items match that search.
            </div>
          )}

          {displayGroups.map((group) => {
            const fullGroup = groups.find((entry) => entry.key === group.key) ?? group;
            const isStagedEmpty = group.customSection && fullGroup.rows.length === 0;
            const sectionIndex = group.customSection ? sectionNames.indexOf(group.key) : -1;
            const SectionIcon = iconChoice(sectionIcons[group.key])?.Icon ?? Layers;
            const isGroupDropTarget =
              dropTarget?.group === group.key && dropTarget.rowId === null;

            return (
              <section
                key={group.key}
                onDragOver={(event) => handleGroupDragOver(event, group.key)}
                onDrop={(event) => dropOnGroup(event, group.key)}
                className={`overflow-hidden rounded-2xl border bg-slate-900/50 transition ${
                  isGroupDropTarget ? "border-amber-400 ring-2 ring-amber-500/30" : "border-slate-800"
                }`}
              >
                <header className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-950/50 px-4 py-3">
                  {group.customSection && renamingSection === group.key ? (
                    <div className="flex min-w-[240px] flex-1 items-center gap-2">
                      <input
                        autoFocus
                        value={renameValue}
                        maxLength={GROUP_MAX}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitRenameSection(group);
                          if (event.key === "Escape") cancelRenameSection();
                        }}
                        className="min-w-0 flex-1 rounded-lg border border-amber-500/50 bg-slate-950 px-3 py-2 text-sm font-bold text-white outline-none"
                        aria-label={`Rename section ${group.label}`}
                      />
                      <button
                        type="button"
                        onClick={() => commitRenameSection(group)}
                        className={`${smallIconButtonClass} border-emerald-500/40 text-emerald-300`}
                        aria-label="Apply section name"
                        title="Apply section name"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={cancelRenameSection}
                        className={smallIconButtonClass}
                        aria-label="Cancel section rename"
                        title="Cancel rename"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="min-w-[220px] flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-extrabold tracking-tight text-white">{group.label}</h3>
                          <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
                            {fullGroup.rows.length} item{fullGroup.rows.length === 1 ? "" : "s"}
                          </span>
                          {isStagedEmpty && (
                            <span className="rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-sky-300">
                              Staged
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {group.key === "top"
                            ? "Shown in the main sidebar list."
                            : group.key === "settings"
                              ? "Shown under General Settings when that role may open it."
                              : isStagedEmpty
                                ? "Empty staged section. It is saved only after an item uses it."
                                : "Custom sidebar section, in first-appearance order."}
                        </p>
                      </div>

                      {group.customSection && (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setIconTarget({ kind: "section", name: group.key })}
                            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-bold text-slate-200 transition hover:bg-slate-800"
                            title="Choose the section header icon"
                          >
                            <SectionIcon className="h-4 w-4 text-amber-400" />
                            {iconChoice(sectionIcons[group.key])?.label ?? "Default icon"}
                          </button>
                          <button
                            type="button"
                            onClick={() => applyRows(moveDesignerSection(rows, group.key, -1))}
                            disabled={busy || isStagedEmpty || sectionIndex <= 0}
                            className={smallIconButtonClass}
                            aria-label={`Move section ${group.label} earlier`}
                            title="Move section earlier"
                          >
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => applyRows(moveDesignerSection(rows, group.key, 1))}
                            disabled={busy || isStagedEmpty || sectionIndex < 0 || sectionIndex >= sectionNames.length - 1}
                            className={smallIconButtonClass}
                            aria-label={`Move section ${group.label} later`}
                            title="Move section later"
                          >
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => beginRenameSection(group)}
                            disabled={busy}
                            className={smallIconButtonClass}
                            aria-label={`Rename section ${group.label}`}
                            title="Rename section"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteSection(fullGroup)}
                            disabled={busy}
                            className={`${smallIconButtonClass} border-rose-500/40 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20`}
                            aria-label={`Delete section ${group.label}`}
                            title={fullGroup.rows.length ? "Delete section and move its items to Top level" : "Delete this empty staged section"}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </header>

                <div className="space-y-2 p-3">
                  {group.rows.length === 0 && (
                    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 px-4 py-6 text-center text-xs font-semibold text-slate-500">
                      Drop a menu item here, use its placement dropdown, or add a new item below.
                    </div>
                  )}

                  {group.rows.map((row) => {
                    const groupIndex = fullGroup.rows.findIndex((entry) => entry.id === row.id);
                    const registryEntry = MENU_REGISTRY.find((entry) => entry.id === row.id);
                    const effectiveIconKey =
                      row.icon ||
                      (row.custom
                        ? row.kind === "link"
                          ? "external-link"
                          : row.target || "dashboard"
                        : row.id);
                    const EffectiveIcon = iconChoice(effectiveIconKey)?.Icon ?? Layers;
                    const selectedIcon = iconChoice(row.icon);
                    const visibleRoles = visibleRolesForDesignerRow(row);
                    const isDragged = draggedId === row.id;
                    const isDropRow = dropTarget?.group === group.key && dropTarget.rowId === row.id;

                    return (
                      <article
                        key={row.id}
                        data-menu-designer-row="true"
                        onDragOver={(event) => handleRowDragOver(event, group.key, row)}
                        onDrop={(event) => dropOnRow(event, group.key, row)}
                        className={`relative rounded-xl border p-3 transition ${
                          row.custom
                            ? "border-sky-500/40 bg-sky-950/20"
                            : "border-slate-800 bg-slate-900/60"
                        } ${isDragged ? "opacity-45" : ""} ${isDropRow ? "ring-2 ring-amber-400/80" : ""}`}
                      >
                        {isDropRow && (
                          <span
                            className={`pointer-events-none absolute inset-x-3 z-10 h-1 rounded-full bg-amber-400 ${
                              dropTarget?.after ? "-bottom-0.5" : "-top-0.5"
                            }`}
                          />
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            draggable={!busy && !searchActive}
                            onDragStart={(event) => startDrag(event, row)}
                            onDragEnd={finishDrag}
                            disabled={busy}
                            className={`flex h-9 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-slate-400 ${
                              searchActive ? "cursor-not-allowed opacity-40" : "cursor-grab active:cursor-grabbing"
                            }`}
                            aria-label={`Drag ${row.label} to reorder`}
                            title={searchActive ? "Clear the search to drag items" : "Drag to reorder or move to another placement"}
                          >
                            <GripVertical className="h-4 w-4" />
                          </button>
                          <div className="flex shrink-0 flex-col gap-0.5">
                            <button
                              type="button"
                              onClick={() => applyRows(moveDesignerRowWithinGroup(rows, row.id, -1))}
                              disabled={busy || groupIndex <= 0}
                              className="rounded bg-slate-800 p-1 text-slate-300 transition hover:bg-slate-700 disabled:opacity-30"
                              aria-label={`Move ${row.label} up in ${group.label}`}
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => applyRows(moveDesignerRowWithinGroup(rows, row.id, 1))}
                              disabled={busy || groupIndex < 0 || groupIndex >= fullGroup.rows.length - 1}
                              className="rounded bg-slate-800 p-1 text-slate-300 transition hover:bg-slate-700 disabled:opacity-30"
                              aria-label={`Move ${row.label} down in ${group.label}`}
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => setIconTarget({ kind: "row", id: row.id, label: row.label })}
                            disabled={busy}
                            className="flex min-w-[106px] items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-left text-[11px] font-bold text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
                            title="Open the visual icon gallery"
                          >
                            <EffectiveIcon className="h-4 w-4 shrink-0 text-amber-400" />
                            <span className="truncate">{selectedIcon?.label ?? "Auto icon"}</span>
                          </button>

                          <input
                            value={row.label}
                            maxLength={LABEL_MAX}
                            onChange={(event) =>
                              patchRow(row.id, { label: event.target.value }, `row:${row.id}:label`)
                            }
                            className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-white outline-none focus:border-amber-500/60"
                            aria-label={`Menu label for ${registryEntry?.label ?? row.id}`}
                          />
                          <input
                            value={row.badge}
                            maxLength={BADGE_MAX}
                            placeholder={`badge (${BADGE_MAX})`}
                            onChange={(event) =>
                              patchRow(row.id, { badge: event.target.value }, `row:${row.id}:badge`)
                            }
                            className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-[11px] font-bold uppercase text-amber-400 outline-none focus:border-amber-500/60"
                            aria-label={`Badge for ${row.label}`}
                          />
                          <select
                            value={row.group}
                            onChange={(event) => chooseGroup(row, event.target.value)}
                            disabled={busy}
                            className="max-w-[230px] rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs font-bold text-slate-300 outline-none"
                            aria-label={`Placement for ${row.label}`}
                          >
                            {groups.map((placement) => (
                              <option key={placement.key} value={placement.key}>
                                {placement.key === "top"
                                  ? "Top level"
                                  : placement.key === "settings"
                                    ? "Under General Settings"
                                    : `Section: ${placement.label}`}
                              </option>
                            ))}
                            <option value={NEW_GROUP}>Add new section...</option>
                          </select>
                          {row.custom && (
                            <button
                              type="button"
                              onClick={() => removeRow(row)}
                              disabled={busy}
                              className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-rose-400 transition hover:bg-rose-500/25 disabled:opacity-50"
                              aria-label={`Remove custom menu item ${row.label}`}
                              title="Remove this custom menu item"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-1 text-[11px] font-semibold text-slate-500 sm:pl-[104px]">
                          <span title={visibleRoles.length ? visibleRoles.join(", ") : "No role sees this entry"}>
                            Visible to {visibleRoles.length} of {roles.length} roles
                          </span>
                          <span>
                            {row.custom && row.kind === "link"
                              ? "Audience controls below apply only to this external website shortcut."
                              : "Access Profiles decide visibility; optional modules may narrow it in the preview."}
                          </span>
                          <span className="text-slate-600">{row.custom ? `Custom ID: ${row.id}` : `Screen: ${row.id}`}</span>
                        </div>

                        {row.custom && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 pl-1 sm:pl-[104px]">
                            <span className="rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-sky-300">
                              Custom
                            </span>
                            <select
                              value={row.kind === "link" ? "link" : "tab"}
                              onChange={(event) =>
                                changeCustomKind(row, event.target.value === "link" ? "link" : "tab")
                              }
                              className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs font-bold text-slate-300 outline-none"
                              aria-label={`Custom item type for ${row.label}`}
                            >
                              <option value="tab">Opens a screen</option>
                              <option value="link">Opens a website (new tab)</option>
                            </select>
                            {row.kind === "link" ? (
                              <input
                                value={row.target ?? ""}
                                maxLength={500}
                                placeholder="https://example.com"
                                onChange={(event) =>
                                  patchRow(row.id, { target: event.target.value }, `row:${row.id}:target`)
                                }
                                className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-white outline-none focus:border-sky-500/60"
                                aria-label={`Website address for ${row.label}`}
                              />
                            ) : (
                              <select
                                value={MENU_REGISTRY.some((entry) => entry.id === row.target) ? row.target : "dashboard"}
                                onChange={(event) => patchRow(row.id, { target: event.target.value })}
                                className="max-w-[280px] rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs font-bold text-slate-300 outline-none"
                                aria-label={`Target screen for ${row.label}`}
                              >
                                {MENU_REGISTRY.map((entry) => (
                                  <option key={entry.id} value={entry.id}>
                                    {entry.label}
                                  </option>
                                ))}
                              </select>
                            )}
                          </div>
                        )}

                        {row.custom && row.kind === "link" && (
                          <div className="mt-2 flex flex-wrap items-center gap-3 pl-1 sm:pl-[104px]">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                              Website link audience:
                            </span>
                            {roles.map((role) => (
                              <label
                                key={role}
                                className="flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-slate-300"
                              >
                                <input
                                  type="checkbox"
                                  checked={!!row.roles[role]}
                                  onChange={(event) =>
                                    patchRow(row.id, {
                                      roles: { ...row.roles, [role]: event.target.checked },
                                    })
                                  }
                                  className="accent-amber-500"
                                />
                                {role}
                              </label>
                            ))}
                          </div>
                        )}
                      </article>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => addItem(group.key)}
                    disabled={busy}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-700 bg-slate-950/30 px-3 py-2.5 text-xs font-bold text-slate-400 transition hover:border-sky-500/50 hover:text-sky-300 disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add item to {group.label}
                  </button>
                </div>
              </section>
            );
          })}

          <div className="rounded-2xl border border-emerald-500/30 bg-slate-900/70 p-4">
            <h3 className="text-sm font-extrabold tracking-tight text-white">Landing screen per role</h3>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              The first screen each role opens after sign-in. Factory default keeps the built-in behaviour
              (operator to station, floor supervisor to reception, warehouse supervisor to warehouse).
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {roles.map((role) => (
                <div
                  key={role}
                  className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                >
                  <span className="flex-1 truncate text-xs font-bold text-slate-300">{role}</span>
                  <select
                    value={landing[role] ?? ""}
                    onChange={(event) => setLandingFor(role, event.target.value)}
                    className="max-w-[220px] rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs font-bold text-slate-300 outline-none"
                    aria-label={`Landing screen for ${role}`}
                  >
                    <option value="">Factory default</option>
                    {landingChoices(role).map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-[11px] leading-relaxed text-slate-400">
            <Globe className="mt-0.5 h-4 w-4 shrink-0 text-sky-400" />
            <p>
              <span className="font-bold text-slate-300">How to use it:</span> drag by the handle inside a
              placement or into another placement. Drop on the top or bottom half of a row to choose the exact
              side, or drop on empty placement space to append. The arrows remain available for touch and
              keyboard-friendly fine adjustments. Blue rows are custom entries. An in-app shortcut follows the
              target screen Access Profile; only an external website shortcut has its own audience. A section
              header appears only for people who can see at least one item inside it.
            </p>
          </div>
        </div>
      </div>

      {iconTarget && (
        <IconGalleryModal
          title={iconTitleForTarget()}
          value={iconValueForTarget()}
          autoLabel={iconTarget.kind === "section" ? "Default icon" : "Auto icon"}
          onPick={pickIcon}
          onClose={() => setIconTarget(null)}
        />
      )}
    </div>
  );
}
