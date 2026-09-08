"use client";

import React, { useState } from "react";
import { ArrowDown, ArrowUp, RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import {
  MENU_REGISTRY,
  defaultVisibleFor,
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
  group: "top" | "settings";
  roles: Record<string, boolean>;
}

function buildRows(cfg: MenuConfig | null): Row[] {
  const byId = new Map((cfg?.items ?? []).map((i) => [i.id, i]));
  const ordered = [
    ...(cfg?.items ?? []).map((i) => i.id).filter((id) => MENU_REGISTRY.some((r) => r.id === id)),
    ...MENU_REGISTRY.map((r) => r.id).filter((id) => !byId.has(id)),
  ];
  return ordered
    .filter((id) => id !== "designer")
    .map((id) => {
      const reg = MENU_REGISTRY.find((r) => r.id === id)!;
      const c = byId.get(id);
      const roles: Record<string, boolean> = {};
      for (const r of allRoles()) {
        roles[r] = typeof c?.roles?.[r] === "boolean" ? c.roles[r]! : defaultVisibleFor(r, id);
      }
      return {
        id,
        label: c?.label ?? reg.label,
        badge: c?.badge ?? reg.badge,
        group: c?.group ?? reg.group,
        roles,
      };
    });
}

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

  const save = async () => {
    setBusy(true);
    setStatus("");
    try {
      const items: MenuConfigItem[] = rows.map((r) => ({
        id: r.id,
        label: r.label,
        badge: r.badge,
        group: r.group,
        roles: r.roles,
      }));
      const res = await fetch("/api/menu-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: 1, items }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      onSaved(data.config);
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
              Changes apply to all devices on the network after Save.
            </p>
          </div>
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
          <div key={row.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
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
                maxLength={40}
                onChange={(e) => patch(i, { label: e.target.value })}
                className="flex-1 min-w-[180px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm font-semibold text-white focus:border-amber-500/60 outline-none"
              />
              <input
                value={row.badge}
                maxLength={10}
                placeholder="badge"
                onChange={(e) => patch(i, { badge: e.target.value })}
                className="w-20 rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-[11px] font-bold uppercase text-amber-400 focus:border-amber-500/60 outline-none"
              />
              <select
                value={row.group}
                onChange={(e) => patch(i, { group: e.target.value as "top" | "settings" })}
                className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-2 text-xs font-bold text-slate-300 outline-none"
              >
                <option value="top">Top level</option>
                <option value="settings">Under General Settings</option>
              </select>
            </div>
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
    </div>
  );
}
