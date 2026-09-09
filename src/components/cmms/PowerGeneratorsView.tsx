"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Zap,
  Gauge,
  Fuel,
  Droplet,
  Activity,
  SlidersHorizontal,
  X,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  MapPin,
  Pencil,
  Trash2,
} from "lucide-react";

interface Props {
  currentUser: any;
  onChanged: () => void;
}

const POWER_STATES = ["Running", "Standby", "Maintenance Required", "Offline"];

function statusPill(status: string) {
  if (status === "Running") return "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40";
  if (status === "Standby") return "bg-amber-500/20 text-amber-300 border border-amber-500/40";
  if (status === "Maintenance Required") return "bg-rose-500/20 text-rose-300 border border-rose-500/40";
  return "bg-slate-700/60 text-slate-300 border border-slate-600";
}

function barColor(kind: "load" | "fuel", value: number) {
  if (kind === "load") {
    if (value >= 90) return "bg-rose-500";
    if (value >= 70) return "bg-amber-400";
    return "bg-emerald-500";
  }
  if (value <= 25) return "bg-rose-500";
  if (value <= 50) return "bg-amber-400";
  return "bg-emerald-500";
}

export default function PowerGeneratorsView({ currentUser, onChanged }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [console_, setConsole] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({});

  const canManage = ["Manager", "Technician", "QA & Dispatch"].includes(currentUser?.role);
  const [editUnit, setEditUnit] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>({});

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/cmms/telemetry", { cache: "no-store" });
      if (!res.ok) throw new Error(`Server returned status ${res.status}.`);
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) throw new Error("Invalid response from server.");
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load fleet telemetry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => load(true), 25000);
    return () => clearInterval(t);
  }, [load]);

  const openConsole = (unit: any) => {
    setForm({
      powerStatus: unit.powerStatus,
      loadOutputPercent: String(unit.loadOutputPercent),
      fuelReservePercent: String(unit.fuelReservePercent),
      oilPressureBar: String(unit.oilPressureBar),
      ratingKva: String(unit.ratingKva),
      runtimeHours: String(unit.runtimeHours),
      logReading: true,
    });
    setConsole(unit);
    setError("");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!console_) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/cmms/telemetry", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: console_.id, ...form, performedById: currentUser?.id }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to save telemetry");
      setConsole(null);
      setNotice(`Diagnostic reading captured for ${console_.assetTag}.`);
      setTimeout(() => setNotice(""), 4000);
      await load(true);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save telemetry");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (unit: any) => {
    setEditForm({
      assetTag: unit.assetTag ?? "",
      name: unit.name ?? "",
      brand: unit.brand ?? "",
      assetType: unit.assetType ?? "Generators",
      site: unit.site ?? "",
      serialNumber: unit.serialNumber ?? "",
      series: unit.series ?? "",
      productionYear: unit.productionYear ? String(unit.productionYear) : "",
      ratingKva: String(unit.ratingKva ?? ""),
      powerStatus: unit.powerStatus ?? "Standby",
      status: unit.status ?? "Operational",
      criticality: unit.criticality ?? "Medium",
      runtimeHours: String(unit.runtimeHours ?? 0),
      serviceIntervalHours: String(unit.serviceIntervalHours ?? 500),
      lastServiceHours: String(unit.lastServiceHours ?? 0),
      notes: unit.notes ?? "",
    });
    setEditUnit(unit);
    setError("");
  };

  const submitEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editUnit) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/cmms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editUnit.id, machineId: editUnit.machineId ?? null, ...editForm }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to save asset");
      setEditUnit(null);
      setNotice(`Asset ${editForm.assetTag || editUnit.assetTag} updated.`);
      setTimeout(() => setNotice(""), 4000);
      await load(true);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save asset");
    } finally {
      setSaving(false);
    }
  };

  const removeUnit = async (unit: any) => {
    if (!confirm(`Delete ${unit.assetTag} — ${unit.name}? Its maintenance history will also be deleted.`)) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/cmms?assetId=${unit.id}`, { method: "DELETE" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to delete asset");
      setNotice(`${unit.assetTag} removed from the fleet.`);
      setTimeout(() => setNotice(""), 4000);
      await load(true);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete asset");
    } finally {
      setSaving(false);
    }
  };

  const fleet: any[] = data?.fleet ?? [];
  const summary = data?.summary ?? {};

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-28 animate-pulse rounded-2xl border border-slate-800 bg-slate-800/40" />
        <div className="grid gap-6 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-80 animate-pulse rounded-2xl border border-slate-800 bg-slate-800/40" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <Zap className="mt-0.5 h-6 w-6 flex-shrink-0 text-amber-400" />
          <div>
            <h2 className="text-lg font-black tracking-tight text-white">Power &amp; Generator Fleet Telemetry</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Live status, load output, oil pressure, and fuel reserves for facility generators
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[11px] font-bold text-emerald-300">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" /> Telemetry Sync Active
          </span>
          <button
            onClick={() => load(true)}
            title="Refresh telemetry"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300 transition hover:text-white"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin text-emerald-400" : ""}`} />
          </button>
        </div>
      </div>

      {(error || notice) && (
        <div
          className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-xs font-bold ${error ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}
        >
          <span className="flex items-center gap-2">
            {error ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {error || notice}
          </span>
          <button onClick={() => { setError(""); setNotice(""); }} className="rounded-lg p-1 hover:bg-white/10">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Fleet summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MiniStat label="Units" value={String(summary.totalUnits ?? 0)} tone="text-white" />
        <MiniStat label="Running" value={String(summary.running ?? 0)} tone="text-emerald-400" />
        <MiniStat label="Standby" value={String(summary.standby ?? 0)} tone="text-amber-400" />
        <MiniStat label="Active Load" value={`${summary.activeLoadKva ?? 0} kVA`} tone="text-blue-400" />
        <MiniStat label="Alarms" value={String(summary.alarmCount ?? 0)} tone={summary.alarmCount ? "text-rose-400" : "text-slate-400"} />
      </div>

      {/* Generator cards */}
      {fleet.length === 0 ? (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-16 text-center">
          <Zap className="mx-auto mb-3 h-14 w-14 stroke-[1.5] text-slate-600" />
          <h3 className="text-base font-bold text-white">No powered plant registered</h3>
          <p className="mt-1 text-xs text-slate-400">
            Register an asset with type <strong>Generators</strong> (or set a kVA rating) to see it on this telemetry board.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {fleet.map((u) => (
            <div
              key={u.id}
              className={`flex flex-col rounded-2xl border bg-slate-900/90 p-5 shadow-sm transition ${
                u.powerStatus === "Maintenance Required"
                  ? "border-rose-500/50"
                  : u.powerStatus === "Running"
                    ? "border-emerald-500/30"
                    : "border-slate-800/80"
              }`}
            >
              {/* Head */}
              <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
                <div className="min-w-0">
                  <div className="text-[11px] font-black uppercase tracking-wider text-slate-500">{u.brand}</div>
                  <h3 className="mt-0.5 text-base font-black leading-tight text-white">{u.name}</h3>
                </div>
                <span className={`shrink-0 rounded-lg px-2.5 py-1.5 text-center text-[10px] font-black uppercase leading-tight ${statusPill(u.powerStatus)}`}>
                  {u.powerStatus}
                </span>
              </div>

              {/* Gauges */}
              <div className="grid grid-cols-2 gap-3 py-4">
                <GaugeBox label="Load Output" value={`${u.loadOutputPercent}%`} accent={u.overloaded ? "text-rose-400" : "text-amber-300"}>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div className={`h-full rounded-full ${barColor("load", u.loadOutputPercent)}`} style={{ width: `${u.loadOutputPercent}%` }} />
                  </div>
                </GaugeBox>

                <GaugeBox label="Fuel Reserve" value={`${u.fuelReservePercent}%`} accent={u.lowFuel ? "text-rose-400" : "text-emerald-300"}>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                    <div className={`h-full rounded-full ${barColor("fuel", u.fuelReservePercent)}`} style={{ width: `${u.fuelReservePercent}%` }} />
                  </div>
                </GaugeBox>

                <GaugeBox
                  label="Oil Pressure"
                  value={
                    <>
                      {Number(u.oilPressureBar).toFixed(1)} <span className="text-xs font-semibold text-slate-500">bar</span>
                    </>
                  }
                  accent={u.lowOilPressure ? "text-rose-400" : "text-white"}
                />

                <GaugeBox
                  label="Rating"
                  value={
                    <>
                      {u.ratingKva} <span className="text-xs font-semibold text-slate-500">kVA</span>
                    </>
                  }
                  accent="text-blue-300"
                />
              </div>

              {/* Alarms */}
              {u.alarms.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {u.alarms.map((a: string) => (
                    <span key={a} className="rounded border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                      <AlertTriangle className="mr-1 inline h-3 w-3" />
                      {a}
                    </span>
                  ))}
                </div>
              )}

              {/* Footer */}
              <div className="mt-auto space-y-3">
                <div className="flex items-center justify-between border-t border-slate-800 pt-3 text-[11px]">
                  <span className="text-slate-400">
                    Meter: <strong className="font-mono text-slate-200">{Number(u.runtimeHours).toLocaleString()} hrs</strong>
                  </span>
                  <span className="flex items-center gap-1 truncate text-slate-400">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <strong className="truncate text-slate-200">{u.site}</strong>
                  </span>
                </div>

                <button
                  onClick={() => openConsole(u)}
                  disabled={!canManage}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 py-2.5 text-xs font-bold text-slate-200 transition hover:border-emerald-500/50 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  title={canManage ? "Capture a live diagnostic reading" : "Manager, Technician or QA & Dispatch role required"}
                >
                  <SlidersHorizontal className="h-4 w-4 text-emerald-400" />
                  Open Engine Diagnostic Console
                </button>

                {canManage && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => openEdit(u)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 py-2 text-xs font-bold text-slate-200 transition hover:border-emerald-500/50 hover:bg-slate-800"
                      title="Edit this asset"
                    >
                      <Pencil className="h-3.5 w-3.5 text-emerald-400" />
                      Edit Asset
                    </button>
                    <button
                      onClick={() => removeUnit(u)}
                      disabled={saving}
                      className="flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-950 px-4 py-2 text-xs font-bold text-rose-300 transition hover:border-rose-500/50 hover:bg-rose-500/10 disabled:opacity-50"
                      title="Delete this asset and its maintenance history"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Diagnostic console modal */}
      {console_ && (
        <div className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-4 backdrop-blur-sm sm:items-center">
          <form onSubmit={submit} className="my-8 w-full max-w-lg space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-emerald-400">
                  <Activity className="h-3.5 w-3.5" /> Engine diagnostic console
                </div>
                <h3 className="truncate text-base font-black text-white">{console_.name}</h3>
                <p className="mt-0.5 font-mono text-[11px] text-slate-400">{console_.assetTag} · {console_.site}</p>
              </div>
              <button type="button" onClick={() => setConsole(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-300">Operating Status</label>
              <div className="grid grid-cols-2 gap-2">
                {POWER_STATES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setForm({ ...form, powerStatus: s })}
                    className={`rounded-xl border px-3 py-2 text-[11px] font-bold transition ${
                      form.powerStatus === s ? statusPill(s) : "border-slate-700 bg-slate-950 text-slate-400 hover:text-white"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Load Output (%)" icon={Gauge}>
                <input type="number" min="0" max="100" value={form.loadOutputPercent} onChange={(e) => setForm({ ...form, loadOutputPercent: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </Field>
              <Field label="Fuel Reserve (%)" icon={Fuel}>
                <input type="number" min="0" max="100" value={form.fuelReservePercent} onChange={(e) => setForm({ ...form, fuelReservePercent: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </Field>
              <Field label="Oil Pressure (bar)" icon={Droplet}>
                <input type="number" step="0.1" min="0" value={form.oilPressureBar} onChange={(e) => setForm({ ...form, oilPressureBar: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </Field>
              <Field label="Rating (kVA)" icon={Zap}>
                <input type="number" min="0" value={form.ratingKva} onChange={(e) => setForm({ ...form, ratingKva: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </Field>
            </div>

            <Field label="Hour Meter Reading (hrs)" icon={Activity}>
              <input type="number" min="0" value={form.runtimeHours} onChange={(e) => setForm({ ...form, runtimeHours: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
            </Field>

            <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-blue-500/30 bg-blue-500/10 p-3">
              <input type="checkbox" checked={form.logReading} onChange={(e) => setForm({ ...form, logReading: e.target.checked })} className="h-4 w-4 rounded" />
              <span className="text-xs font-bold text-blue-200">Append this capture to the asset maintenance history</span>
            </label>

            <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
              <button type="button" onClick={() => setConsole(null)} className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-emerald-500 px-6 py-2.5 text-xs font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
                {saving ? "Saving…" : "Save Diagnostic Reading"}
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Edit asset modal */}
      {editUnit && (
        <div className="fixed inset-0 z-[95] flex items-start justify-center overflow-y-auto bg-slate-950/85 p-4 backdrop-blur-sm sm:items-center">
          <form onSubmit={submitEdit} className="my-8 w-full max-w-2xl space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div className="min-w-0">
                <div className="mb-1 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-emerald-400">
                  <Pencil className="h-3.5 w-3.5" /> Edit plant asset
                </div>
                <h3 className="truncate text-base font-black text-white">{editUnit.name}</h3>
                <p className="mt-0.5 font-mono text-[11px] text-slate-400">{editUnit.assetTag} · {editUnit.site}</p>
              </div>
              <button type="button" onClick={() => setEditUnit(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Asset Tag" icon={Zap}>
                <input required value={editForm.assetTag} onChange={(e) => setEditForm({ ...editForm, assetTag: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </Field>
              <Field label="Name" icon={Zap}>
                <input required value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white" />
              </Field>
              <Field label="Brand" icon={Zap}>
                <input value={editForm.brand} onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white" />
              </Field>
              <Field label="Asset Type" icon={Zap}>
                <input value={editForm.assetType} onChange={(e) => setEditForm({ ...editForm, assetType: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white" />
              </Field>
              <Field label="Site / Location" icon={MapPin}>
                <input value={editForm.site} onChange={(e) => setEditForm({ ...editForm, site: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white" />
              </Field>
              <Field label="Serial Number" icon={Zap}>
                <input value={editForm.serialNumber} onChange={(e) => setEditForm({ ...editForm, serialNumber: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </Field>
              <Field label="Series" icon={Zap}>
                <input value={editForm.series} onChange={(e) => setEditForm({ ...editForm, series: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white" />
              </Field>
              <Field label="Production Year" icon={Zap}>
                <input type="number" min="1900" max="2100" value={editForm.productionYear} onChange={(e) => setEditForm({ ...editForm, productionYear: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </Field>
              <Field label="Rating (kVA)" icon={Zap}>
                <input type="number" min="0" value={editForm.ratingKva} onChange={(e) => setEditForm({ ...editForm, ratingKva: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </Field>
              <Field label="Hour Meter (hrs)" icon={Activity}>
                <input type="number" min="0" value={editForm.runtimeHours} onChange={(e) => setEditForm({ ...editForm, runtimeHours: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </Field>
              <Field label="Service Interval (hrs)" icon={Gauge}>
                <input type="number" min="1" value={editForm.serviceIntervalHours} onChange={(e) => setEditForm({ ...editForm, serviceIntervalHours: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </Field>
              <Field label="Last Service at (hrs)" icon={Gauge}>
                <input type="number" min="0" value={editForm.lastServiceHours} onChange={(e) => setEditForm({ ...editForm, lastServiceHours: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white" />
              </Field>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-300">Operating Status</label>
              <div className="grid grid-cols-2 gap-2">
                {POWER_STATES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setEditForm({ ...editForm, powerStatus: s })}
                    className={`rounded-xl border px-3 py-2 text-[11px] font-bold transition ${
                      editForm.powerStatus === s ? statusPill(s) : "border-slate-700 bg-slate-950 text-slate-400 hover:text-white"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Field label="Asset Status" icon={CheckCircle2}>
                <select value={editForm.status} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white">
                  <option>Operational</option>
                  <option>Under Maintenance</option>
                  <option>Decommissioned</option>
                </select>
              </Field>
              <Field label="Criticality" icon={AlertTriangle}>
                <select value={editForm.criticality} onChange={(e) => setEditForm({ ...editForm, criticality: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white">
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                  <option>Critical</option>
                </select>
              </Field>
            </div>

            <Field label="Notes" icon={SlidersHorizontal}>
              <textarea rows={3} value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white" />
            </Field>

            <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
              <button type="button" onClick={() => setEditUnit(null)} className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-xl bg-emerald-500 px-6 py-2.5 text-xs font-black text-slate-950 hover:bg-emerald-400 disabled:opacity-50">
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-0.5 font-mono text-lg font-black ${tone}`}>{value}</div>
    </div>
  );
}

function GaugeBox({ label, value, accent, children }: { label: string; value: React.ReactNode; accent: string; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-black ${accent}`}>{value}</div>
      {children}
    </div>
  );
}

function Field({ label, icon: Icon, children }: { label: string; icon: any; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-bold text-slate-300">
        <Icon className="h-3.5 w-3.5 text-slate-500" />
        {label}
      </label>
      {children}
    </div>
  );
}
