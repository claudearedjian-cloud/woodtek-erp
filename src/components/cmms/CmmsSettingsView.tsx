"use client";

import React, { useState } from "react";
import { SlidersHorizontal, MapPin, Wrench, Save, Plus, X, AlertTriangle, CheckCircle2, Info } from "lucide-react";

interface Props {
  settings: any;
  onSettingsChanged: (next: any) => void;
  currentUser: any;
}

export default function CmmsSettingsView({ settings, onSettingsChanged, currentUser }: Props) {
  const [interval, setIntervalValue] = useState(String(settings?.service_interval_hours ?? 500));
  const [newLocation, setNewLocation] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const canManage = currentUser?.role === "Manager" || currentUser?.role === "Technician";

  const locations: string[] = settings?.site_locations ?? [];
  const categories: string[] = settings?.operation_categories ?? [];

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 3500);
  };

  const post = async (payload: any, successMsg: string) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/cmms/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save setting");
      onSettingsChanged(data);
      flash(successMsg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save setting");
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-16 text-center">
        <SlidersHorizontal className="mx-auto mb-3 h-14 w-14 stroke-[1.5] text-slate-600" />
        <h3 className="text-base font-bold text-white">Configuration is restricted</h3>
        <p className="mt-1 text-xs text-slate-400">
          Your role ({currentUser?.role}) can view CMMS data but not change master configuration. Manager or Technician access is required.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-black text-white">
          <SlidersHorizontal className="h-5 w-5 text-emerald-400" /> App Settings &amp; CMMS Configurator
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">System operational thresholds, locations, and maintenance master data</p>

        {(error || notice) && (
          <div className={`mt-4 flex items-center justify-between gap-3 rounded-xl border p-3 text-xs font-bold ${error ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>
            <span className="flex items-center gap-2">
              {error ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {error || notice}
            </span>
            <button onClick={() => { setError(""); setNotice(""); }} className="rounded-lg p-1 hover:bg-white/10"><X className="h-4 w-4" /></button>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Threshold rules */}
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-black text-white">
            <SlidersHorizontal className="h-4 w-4 text-emerald-400" /> Operational Maintenance Threshold Rules
          </h3>
          <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
            Set standard operating hours interval between mandatory preventative service interventions.
          </p>

          <div className="mt-4">
            <label className="mb-1.5 block text-xs font-bold text-slate-300">Service Interval (Hours)</label>
            <input
              type="number"
              min="1"
              value={interval}
              onChange={(e) => setIntervalValue(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-sm text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <button
            onClick={() => post({ action: "set", key: "service_interval_hours", value: interval }, "Threshold rule saved.")}
            disabled={busy}
            className="mt-4 flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> Save Threshold Rule
          </button>

          <p className="mt-4 flex items-start gap-2 rounded-xl border border-blue-500/20 bg-blue-500/10 p-3 text-[11px] leading-relaxed text-blue-100">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            This becomes the default interval pre-filled when registering a new asset. Existing assets keep their own interval until you edit them.
          </p>
        </div>

        {/* Site locations */}
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-black text-white">
            <MapPin className="h-4 w-4 text-emerald-400" /> Manage Site Locations
          </h3>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newLocation.trim()) return;
              post({ action: "add", key: "site_locations", item: newLocation }, "Location added.");
              setNewLocation("");
            }}
            className="mt-4 flex gap-2"
          >
            <input
              type="text"
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              placeholder="New location name..."
              className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
            <button type="submit" disabled={busy} className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-50">
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-2">
            {locations.length === 0 && <p className="text-xs italic text-slate-500">No locations configured.</p>}
            {locations.map((loc) => (
              <span key={loc} className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200">
                {loc}
                <button
                  onClick={() => post({ action: "remove", key: "site_locations", item: loc }, "Location removed.")}
                  className="text-slate-500 transition hover:text-rose-400"
                  title={`Remove ${loc}`}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Operation categories */}
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-black text-white">
          <Wrench className="h-4 w-4 text-emerald-400" /> Manage Operation Categories
        </h3>
        <p className="mt-1.5 text-xs text-slate-400">
          These appear as selectable event types when logging maintenance against an asset.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!newCategory.trim()) return;
            post({ action: "add", key: "operation_categories", item: newCategory }, "Category added.");
            setNewCategory("");
          }}
          className="mt-4 flex max-w-xl gap-2"
        >
          <input
            type="text"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            placeholder="New maintenance category..."
            className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
          />
          <button type="submit" disabled={busy} className="flex items-center gap-1.5 rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-50">
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {categories.length === 0 && <p className="text-xs italic text-slate-500">No categories configured.</p>}
          {categories.map((cat) => (
            <span key={cat} className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[11px] font-semibold text-slate-200">
              {cat}
              <button
                onClick={() => post({ action: "remove", key: "operation_categories", item: cat }, "Category removed.")}
                className="text-slate-500 transition hover:text-rose-400"
                title={`Remove ${cat}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
