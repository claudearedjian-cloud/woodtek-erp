"use client";

import React, { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Globe,
  Plus,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  BADGE_MAX,
  GROUP_MAX,
  LABEL_MAX,
  MENU_REGISTRY,
  defaultVisibleFor,
  isCustomId,
  type MenuConfig,
  type MenuConfigItem,
} from "@/lib/menuConfig";
import { allRoles, registerCustomRoles } from "@/lib/permissions";

interface Props {
  currentUser: any;
  menuConfig: MenuConfig | null;
  onSaved: (c: MenuConfig | null) => void;
}

interface Row {
  id: string;
  label: string;
  badge: string;
  group: string; // "top" | "settings" | custom section name
  roles: Record<string, boolean>;
  custom?: boolean;
  kind?: "tab" | "link";
  target?: string;
}

function buildRows(cfg: MenuConfig | null): Row[] {
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
      for (const r of allRoles()) {
        roles[r] = typeof c?.roles?.[r] === "boolean" ? c.roles[r]! : defaultVisibleFor(r, id);
      }
      return {
        id,
        label: c?.label ?? reg?.label ?? "New menu item",
        badge: c?.badge ?? reg?.badge ?? "",
        group: c?.group ?? reg?.group ?? "top",
        roles,
        custom,
        kind: c?.kind === "link" ? "link" : "tab",
        target: c?.target ?? "dashboard",
      };
    });
}

const NEW_GROUP = "__new-section__";

export default function MenuDesignerView({ menuConfig, onSaved }: Props) {
  const [rows, setRows] = useState<Row[]>(() => buildRows(menuConfig));
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  // Pick up custom roles so their columns appear in the matrix.
  React.useEffect(() => {
    fetch("/api/roles", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { roles: [] }))
      .then((d) => {
        registerCustomRoles(Array.isArray(d.roles) ? d.roles : []);
        setRows(buildRows(menuConfig));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (i: number, d: number) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const c = [...rs];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  const patch = (i: number, p: Partial<Row>) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));

  const removeRow = (i: number) =>
    setRows((rs) => rs.filter((_, k) => k !== i));

  const addItem = () => {
    const id = `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    setRows((rs) => [
      {
        id,
        label: "New menu item",
        badge: "",
        group: "top",
        roles: Object.fromEntries(allRoles().map((r) => [r, r === "Manager"])),
        custom: true,
        kind: "tab",
        target: "dashboard",
      },
      ...rs,
    ]);
    setStatus("New item added at the top — give it a name, pick where it points and who sees it, then Save.");
  };

  // Custom section names currently in use (drives the group dropdown).
  const sectionNames = Array.from(
    new Set(
      rows
        .map((r) => (r.group !== "top" && r.group !== "settings" ? r.group : ""))
        .filter(Boolean),
    ),
  );

  const chooseGroup = (i: number, value: string) => {
    if (value !== NEW_GROUP) {
      patch(i, { group: value });
      return;
    }
    const raw = window.prompt(
      "Name of the new section — it will show as a header in the sidebar (max " + GROUP_MAX + " characters):",
    );
    const name = (raw || "").trim().slice(0, GROUP_MAX);
    if (!name) return; // cancelled or empty -> keep current group
    const existing = sectionNames.find((g) => g.toLowerCase() === name.toLowerCase());
    patch(i, { group: existing || name });
    setStatus(
      existing
        ? `Item moved into the existing section “${existing}”.`
        : `New section “${name}” created — move more items into it, then Save.`,
    );
  };

  const save = async () => {
    setBusy(true);
    setStatus("");
    try {
      const items: MenuConfigItem[] = rows.map((r) => ({
        id: r.id,
        label: r.custom ? r.label.trim() || "New menu item" : r.label,
        badge: r.badge,
        group: r.group,
        roles: r.roles,
        ...(r.custom
          ? {
              custom: true as const,
              kind: r.kind === "link" ? ("link" as const) : ("tab" as const),
              target: r.target || "dashboard",
            }
          : {}),
      }));
      const res = await fetch("/api/menu-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      onSaved(data.config);
      setRows(buildRows(data.config));
      setStatus("Saved — the sidebar updates immediately on every device.");
    } catch (e: any) {
      setStatus("Error: " + (e?.message || e));
    }
    setBusy(false);
  };

  const reset = async () => {
    setBusy(true);
    setStatus("");
    try {
      const res = await fetch("/api/menu-config", { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error || "Reset failed");
      onSaved(null);
      setRows(buildRows(null));
      setStatus("Reset to factory defaults.");
    } catch (e: any) {
      setStatus("Error: " + (e?.message || e));
    }
    setBusy(false);
  };

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="rounded-2xl border border-amber-500/30 bg-slate-900/70 p-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
            <SlidersHorizontal className="w-5 h-5 text-amber-400" />
          </div>
          <div className="flex-1">
            <h2 className="text-lg font-extrabold text-white tracking-tight">Menu Designer</h2>
            <p className="text-xs text-slate-400">
              Rename, reorder, regroup and control per-role visibility of every sidebar item.
              Create your own sections and new menu entries, and give names up to {LABEL_MAX} characters.
              Changes apply to all devices on the network after Save.
            </p>
          </div>
          <button
            onClick={addItem}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 text-xs font-bold border border-sky-500/40 transition disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" /> Add menu item
          </button>
          <button
            onClick={reset}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-bold border border-slate-700 transition disabled:opacity-50"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Reset defaults
          </button>
          <button
            onClick={save}
            disabled={busy}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 text-xs font-black shadow-lg shadow-amber-950/40 transition disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" /> {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
        {status && (
          <div className={`mt-3 text-xs font-bold ${status.startsWith("Error") ? "text-rose-400" : "text-emerald-400"}`}>
            {status}
          </div>
        )}
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div
            key={row.id}
            className={`rounded-xl border p-3 ${
              row.custom
                ? "border-sky-500/40 bg-sky-950/20"
                : "border-slate-800 bg-slate-900/60"
            }`}
          >
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-col gap-0.5">
                <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30" aria-label="Move up">
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => move(i, 1)} disabled={i === rows.length - 1} className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30" aria-label="Move down">
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                value={row.label}
                maxLength={LABEL_MAX}
                onChange={(e) => patch(i, { label: e.target.value })}
                className="flex-1 min-w-[260px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-white focus:border-amber-500/60 outline-none"
              />
              <input
                value={row.badge}
                maxLength={BADGE_MAX}
                placeholder={`badge (${BADGE_MAX})`}
                onChange={(e) => patch(i, { badge: e.target.value })}
                className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-[11px] font-bold uppercase text-amber-400 focus:border-amber-500/60 outline-none"
              />
              <select
                value={row.group}
                onChange={(e) => chooseGroup(i, e.target.value)}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs font-bold text-slate-300 outline-none max-w-[220px]"
              >
                <option value="top">Top level</option>
                <option value="settings">Under General Settings</option>
                {sectionNames.map((g) => (
                  <option key={g} value={g}>
                    Section: {g}
                  </option>
                ))}
                <option value={NEW_GROUP}>➕ New section…</option>
              </select>
              {row.custom && (
                <button
                  onClick={() => removeRow(i)}
                  disabled={busy}
                  className="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/25 text-rose-400 border border-rose-500/40 transition disabled:opacity-50"
                  aria-label="Remove this menu item"
                  title="Remove this menu item"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {row.custom && (
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-9">
                <span className="rounded-full border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[10px] font-black uppercase tracking-wider text-sky-300">
                  Custom
                </span>
                <select
                  value={row.kind === "link" ? "link" : "tab"}
                  onChange={(e) =>
                    patch(i, {
                      kind: e.target.value === "link" ? "link" : "tab",
                      target: e.target.value === "link" ? "" : "dashboard",
                    })
                  }
                  className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs font-bold text-slate-300 outline-none"
                >
                  <option value="tab">Opens a screen</option>
                  <option value="link">Opens a website (new tab)</option>
                </select>
                {row.kind === "link" ? (
                  <input
                    value={row.target}
                    maxLength={500}
                    placeholder="https://example.com"
                    onChange={(e) => patch(i, { target: e.target.value })}
                    className="flex-1 min-w-[220px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-white focus:border-sky-500/60 outline-none"
                  />
                ) : (
                  <select
                    value={MENU_REGISTRY.some((r) => r.id === row.target) ? row.target : "dashboard"}
                    onChange={(e) => patch(i, { target: e.target.value })}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs font-bold text-slate-300 outline-none max-w-[260px]"
                  >
                    {MENU_REGISTRY.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-3 pl-9">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Visible for:</span>
              {allRoles().map((r) => (
                <label key={r} className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!row.roles[r]}
                    onChange={(e) => patch(i, { roles: { ...row.roles, [r]: e.target.checked } })}
                    className="accent-amber-500"
                  />
                  {r}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4 text-[11px] text-slate-400">
        <Globe className="w-4 h-4 shrink-0 text-sky-400 mt-0.5" />
        <p>
          <span className="font-bold text-slate-300">Tips:</span> pick <b>➕ New section…</b> in the
          placement dropdown to create your own sidebar section, then move more items into it.
          Blue rows are entries you created yourself — they can open any screen or any website
          (https) in a new tab, and can be deleted with the trash button. A section header only
          appears for people who can see at least one item inside it.
        </p>
      </div>
    </div>
  );
}
