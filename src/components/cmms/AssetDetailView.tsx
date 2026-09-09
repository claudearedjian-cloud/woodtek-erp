"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Pencil,
  Trash2,
  X,
  ImageIcon,
  Upload,
  CheckSquare,
  CircleCheckBig,
  History,
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Loader2,
} from "lucide-react";

interface Props {
  assetId: number;
  currentUser: any;
  eventTypes: string[];
  onBack: () => void;
  onChanged: () => void;
  onEdit: (asset: any) => void;
}

const CHECKLIST_ITEMS = [
  { key: "lubrication", label: "Lubrication & Greasing Complete" },
  { key: "filters", label: "Oil & Air Filters Inspected" },
  { key: "belts", label: "Belt Tension & Alignment Checked" },
  { key: "estops", label: "Safety E-Stops Tested" },
];

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB

export default function AssetDetailView({ assetId, currentUser, eventTypes, onBack, onChanged, onEdit }: Props) {
  const [asset, setAsset] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [uploading, setUploading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const [checklist, setChecklist] = useState<Record<string, boolean>>({});
  const [opType, setOpType] = useState("");
  const [meter, setMeter] = useState("");
  const [remarks, setRemarks] = useState("");

  const canManage = ["Manager", "Technician", "QA & Dispatch"].includes(currentUser?.role);

  const deleteLog = async (logId: number) => {
    if (!confirm("Delete this maintenance entry? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/cmms/logs?logId=${logId}`, { method: "DELETE" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Could not delete entry");
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete entry");
    }
  };

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 4000);
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/cmms?assetId=${assetId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Server returned status ${res.status}.`);
      const ct = res.headers.get("content-type") || "";
      if (!ct.includes("application/json")) throw new Error("Invalid response from server.");
      const data = await res.json();
      setAsset(data);
      setMeter(String(data.runtimeHours));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load asset.");
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (!opType && eventTypes.length > 0) setOpType(eventTypes[0]);
  }, [eventTypes, opType]);

  const handleImage = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file (PNG, JPG or WebP).");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError(`Image is ${(file.size / 1024 / 1024).toFixed(1)} MB. Please use a file under 3 MB.`);
      return;
    }
    setUploading(true);
    setError("");
    try {
      const dataUrl: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read the selected file."));
        reader.readAsDataURL(file);
      });

      const res = await fetch("/api/cmms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: assetId, imageUrl: dataUrl }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Upload failed");
      setAsset((prev: any) => ({ ...prev, imageUrl: payload.imageUrl }));
      flash("Machine image updated.");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const removeImage = async () => {
    setUploading(true);
    setError("");
    try {
      const res = await fetch("/api/cmms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: assetId, imageUrl: null }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Could not remove image");
      setAsset((prev: any) => ({ ...prev, imageUrl: null }));
      flash("Machine image removed.");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove image");
    } finally {
      setUploading(false);
    }
  };

  const commit = async () => {
    if (!remarks.trim()) {
      setError("Please add task remarks describing the work performed.");
      return;
    }
    setCommitting(true);
    setError("");
    try {
      const done = CHECKLIST_ITEMS.filter((c) => checklist[c.key]).map((c) => c.label);
      const res = await fetch("/api/cmms/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetId,
          eventType: opType || "Preventative Maintenance",
          description: remarks.trim(),
          runtimeAtEvent: meter,
          resetService: true,
          performedById: currentUser?.id,
          checklist: { completed: done, total: CHECKLIST_ITEMS.length },
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Could not commit maintenance");
      setRemarks("");
      setChecklist({});
      flash("Maintenance committed — service gauge reset to current meter.");
      await load();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not commit maintenance");
    } finally {
      setCommitting(false);
    }
  };

  const decommission = async () => {
    if (!confirm(`Decommission ${asset?.assetTag}? This permanently removes the asset and its maintenance history.`)) return;
    try {
      const res = await fetch(`/api/cmms?assetId=${assetId}`, { method: "DELETE" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Could not decommission");
      onChanged();
      onBack();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not decommission");
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-16 animate-pulse rounded-2xl border border-slate-800 bg-slate-800/40" />
        <div className="h-64 animate-pulse rounded-2xl border border-slate-800 bg-slate-800/40" />
        <div className="h-80 animate-pulse rounded-2xl border border-slate-800 bg-slate-800/40" />
      </div>
    );
  }

  if (!asset) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-16 text-center">
        <AlertTriangle className="mx-auto mb-3 h-12 w-12 text-rose-400" />
        <h3 className="text-base font-bold text-white">Asset could not be loaded</h3>
        <button onClick={onBack} className="mt-4 rounded-xl bg-slate-800 px-5 py-2.5 text-xs font-bold text-slate-200 hover:bg-slate-700">
          Back to Fleet Dashboard
        </button>
      </div>
    );
  }

  const pct = Math.min(100, asset.percentUsed ?? 0);
  const barTone = asset.isOverdue ? "bg-rose-500" : asset.isDue ? "bg-amber-500" : "bg-emerald-500";

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={onBack}
            className="flex shrink-0 items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
          >
            <ArrowLeft className="h-4 w-4" /> Back to Fleet Dashboard
          </button>
          <h2 className="truncate text-lg font-black tracking-tight text-white">{asset.name}</h2>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => onEdit(asset)}
              className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-200 transition hover:bg-slate-700"
            >
              <Pencil className="h-3.5 w-3.5" /> Edit Details
            </button>
            <button
              onClick={decommission}
              className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2 text-xs font-bold text-rose-300 transition hover:bg-rose-500/25"
            >
              <Trash2 className="h-3.5 w-3.5" /> Decommission
            </button>
          </div>
        )}
      </div>

      {(error || notice) && (
        <div className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-xs font-bold ${error ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>
          <span className="flex items-center gap-2">
            {error ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            {error || notice}
          </span>
          <button onClick={() => { setError(""); setNotice(""); }} className="rounded-lg p-1 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Image + spec grid */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_1fr]">
        {/* Machine image */}
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800/80 bg-slate-900/90 p-6 shadow-sm">
          {asset.imageUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={asset.imageUrl}
                alt={`${asset.name} photograph`}
                className="max-h-52 w-full rounded-xl border border-slate-800 object-contain"
              />
              <div className="mt-4 flex w-full gap-2">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={!canManage || uploading}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 py-2 text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-50"
                >
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  Replace
                </button>
                <button
                  onClick={removeImage}
                  disabled={!canManage || uploading}
                  className="rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-slate-400 transition hover:text-rose-400 disabled:opacity-50"
                  title="Remove image"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex h-32 w-full flex-col items-center justify-center rounded-xl text-slate-600">
                <ImageIcon className="mb-3 h-12 w-12 stroke-[1.5]" />
                <p className="text-xs font-semibold text-slate-500">No Machine Image Loaded</p>
              </div>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={!canManage || uploading}
                className="mt-5 flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-50"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {uploading ? "Uploading…" : "Upload New Image"}
              </button>
              {!canManage && <p className="mt-2 text-[10px] text-slate-600">Manager, Technician or QA &amp; Dispatch role required</p>}
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImage(f);
            }}
          />
        </div>

        {/* Lifecycle + specs */}
        <div className="space-y-4">
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-bold text-white">Maintenance Lifecycle</span>
              <span className={`font-mono text-sm font-black ${asset.isOverdue ? "text-rose-400" : "text-white"}`}>
                {asset.sinceService} / {asset.serviceIntervalHours} hrs
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800">
              <div className={`h-full rounded-full transition-all duration-500 ${barTone}`} style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {asset.isOverdue
                ? `Overdue by ${Math.abs(asset.hoursRemaining)} hrs — service required immediately.`
                : `${asset.hoursRemaining} hrs remaining until next required service check.`}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Spec label="Brand" value={asset.brand} />
            <Spec label="Series" value={asset.series || "—"} />
            <Spec label="Serial Number (SN)" value={asset.serialNumber || "—"} mono />
            <Spec label="Production Date" value={asset.productionYear ? String(asset.productionYear) : asset.installedAt ? String(new Date(asset.installedAt).getFullYear()) : "—"} />
            <Spec label="Workstation Site" value={asset.site} />
            <Spec label="Total Hours Meter" value={`${Number(asset.runtimeHours).toLocaleString()} hrs`} />
          </div>
        </div>
      </div>

      {/* Technician checklist + commit */}
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-black text-white">
          <CheckSquare className="h-4 w-4 text-emerald-400" /> Technician Pre-Service Inspection Checklist
        </h3>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
          {CHECKLIST_ITEMS.map((item) => (
            <label
              key={item.key}
              className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-xs font-semibold transition ${
                checklist[item.key]
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border-slate-700 bg-slate-950/70 text-slate-300 hover:border-slate-600"
              }`}
            >
              <input
                type="checkbox"
                checked={!!checklist[item.key]}
                onChange={(e) => setChecklist({ ...checklist, [item.key]: e.target.checked })}
                disabled={!canManage}
                className="h-4 w-4 rounded"
              />
              {item.label}
            </label>
          ))}
        </div>

        <div className="mt-6 border-t border-slate-800 pt-5">
          <h4 className="text-sm font-bold text-white">Record Maintenance Operation</h4>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-300">Select Operation Type</label>
              <select
                value={opType}
                onChange={(e) => setOpType(e.target.value)}
                disabled={!canManage}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              >
                {eventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-300">Current Machine Meter (Hours)</label>
              <input
                type="number"
                min="0"
                value={meter}
                onChange={(e) => setMeter(e.target.value)}
                disabled={!canManage}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none disabled:opacity-50"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-xs font-bold text-slate-300">Task Remarks &amp; Checklist Notes</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              disabled={!canManage}
              placeholder="Enter service details, replaced parts, or observation notes..."
              className="h-24 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
            />
          </div>

          <button
            onClick={commit}
            disabled={!canManage || committing}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3 text-sm font-black text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {committing ? <Loader2 className="h-5 w-5 animate-spin" /> : <CircleCheckBig className="h-5 w-5" />}
            {committing ? "Committing…" : "Commit Maintenance & Reset Gauge"}
          </button>
          {!canManage && (
            <p className="mt-2 text-center text-[11px] text-slate-500">
              Read-only view — Manager, Technician or QA &amp; Dispatch role is required to commit maintenance.
            </p>
          )}
        </div>
      </div>

      {/* Log history */}
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-black text-white">
          <History className="h-4 w-4 text-blue-400" /> Log History
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-bold text-slate-300">{asset.logs?.length ?? 0}</span>
        </h3>

        {(asset.logs?.length ?? 0) === 0 ? (
          <p className="py-10 text-center text-xs italic text-slate-500">No maintenance events recorded for this asset yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {asset.logs.map((l: any) => (
              <li key={l.id} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] font-black uppercase text-slate-300">{l.eventType}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[10px] text-slate-500">
                      {new Date(l.createdAt).toLocaleString()} · {Number(l.runtimeAtEvent).toLocaleString()} hrs
                    </span>
                    {canManage && (
                      <button
                        onClick={() => deleteLog(l.id)}
                        title="Delete entry"
                        className="rounded p-1 text-slate-600 transition hover:bg-rose-500/20 hover:text-rose-400"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </span>
                </div>
                <p className="mt-2 text-xs text-slate-200">{l.description}</p>
                {l.checklistJson?.completed?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {l.checklistJson.completed.map((c: string) => (
                      <span key={c} className="rounded border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">
                        <CheckCircle2 className="mr-1 inline h-2.5 w-2.5" />{c}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center gap-x-3 text-[10px] text-slate-500">
                  {l.performedByName && <span>By {l.performedByName}</span>}
                  {l.downtimeMinutes > 0 && <span>{l.downtimeMinutes}m downtime</span>}
                  {(parseFloat(l.partsCost) > 0 || parseFloat(l.laborCost) > 0) && (
                    <span className="text-emerald-400">
                      <DollarSign className="inline h-3 w-3" />
                      {(parseFloat(l.partsCost) + parseFloat(l.laborCost)).toFixed(2)}
                    </span>
                  )}
                  {l.resetService && <span className="font-bold text-emerald-400">Meter reset</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Spec({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 truncate text-sm font-bold text-white ${mono ? "font-mono" : ""}`} title={value}>{value}</div>
    </div>
  );
}
