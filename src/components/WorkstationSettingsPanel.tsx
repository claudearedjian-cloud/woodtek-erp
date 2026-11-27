"use client";

import { Fragment, useCallback, useEffect, useState, type FormEvent } from "react";
import { CheckCircle2, Cpu, Loader2, Pencil, Plus, RefreshCw, Save, Trash2, Wrench, X } from "lucide-react";

interface Workstation {
  id: number;
  code: string;
  name: string;
  category: string;
  location: string;
  status: string;
  queueCount?: number;
}

interface PlantAsset {
  id: number;
  assetTag: string;
  name: string;
  brand: string;
  assetType: string;
  site: string;
  machineId: number | null;
  serialNumber?: string | null;
  status?: string;
}

interface WorkstationForm {
  code: string;
  name: string;
  category: string;
  location: string;
  status: string;
}

const EMPTY_FORM: WorkstationForm = { code: "", name: "", category: "CNC Router", location: "Shop Floor", status: "Active" };

export default function WorkstationSettingsPanel() {
  const [workstations, setWorkstations] = useState<Workstation[]>([]);
  const [plantAssets, setPlantAssets] = useState<PlantAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<WorkstationForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/machines?summary=true", { cache: "no-store" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not load workstations (${response.status}).`);
      setWorkstations(Array.isArray(body) ? body : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load workstations.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPlantAssets = useCallback(async () => {
    try {
      const response = await fetch("/api/cmms", { cache: "no-store" });
      if (!response.ok) return;
      const body = await response.json();
      setPlantAssets(Array.isArray(body.assets) ? body.assets : []);
    } catch {
      // Creating a standalone workstation remains available if CMMS is not enabled.
    }
  }, []);

  useEffect(() => { void load(); void loadPlantAssets(); }, [load, loadPlantAssets]);

  const selectPlantAsset = (assetId: string) => {
    setSelectedAssetId(assetId);
    const asset = plantAssets.find((item) => String(item.id) === assetId);
    if (!asset) return;
    setForm({
      code: asset.assetTag.slice(0, 32),
      name: asset.name,
      category: asset.assetType,
      location: asset.site,
      status: asset.status === "Under Maintenance" ? "Maintenance" : asset.status === "Decommissioned" ? "Offline" : "Active",
    });
  };

  const validate = (values: WorkstationForm, excludeId?: number) => {
    const code = values.code.trim().toUpperCase();
    const name = values.name.trim();
    const category = values.category.trim();
    const location = values.location.trim();
    if (!code || !name || !category || !location) {
      setError("Enter a workstation code, name, category, and location.");
      return null;
    }
    if (workstations.some((machine) => machine.id !== excludeId && machine.code.toUpperCase() === code)) {
      setError(`Workstation code ${code} already exists.`);
      return null;
    }
    return { code, name, category, location, status: values.status };
  };

  const addWorkstation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = validate(form);
    if (!values) return;
    setSaving(true);
    setError("");
    setNotice("");
    const sourceAsset = plantAssets.find((asset) => String(asset.id) === selectedAssetId);
    try {
      const response = await fetch("/api/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...values,
          assetId: selectedAssetId ? Number(selectedAssetId) : undefined,
          notes: sourceAsset ? [sourceAsset.brand, sourceAsset.serialNumber ? `Serial ${sourceAsset.serialNumber}` : "", `CMMS asset ${sourceAsset.assetTag}`].filter(Boolean).join(" · ") : undefined,
          hourlyCost: "0.00",
          assignedOperatorIds: [],
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not add workstation (${response.status}).`);
      setForm(EMPTY_FORM);
      setSelectedAssetId("");
      await loadPlantAssets();
      setNotice(`${values.code} added. It is now available in Operator Station and in CMMS machine-link choices.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add workstation.");
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (machine: Workstation) => {
    setError("");
    setNotice("");
    setEditingId(machine.id);
    setEditForm({
      code: machine.code,
      name: machine.name,
      category: machine.category,
      location: machine.location,
      status: ["Active", "Maintenance", "Offline"].includes(machine.status) ? machine.status : "Active",
    });
  };

  const updateWorkstation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editingId == null) return;
    const values = validate(editForm, editingId);
    if (!values) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/machines/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not update workstation (${response.status}).`);
      setEditingId(null);
      setNotice(`${values.code} updated.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update workstation.");
    } finally {
      setSaving(false);
    }
  };

  const deleteWorkstation = async (machine: Workstation) => {
    const queued = Number(machine.queueCount ?? 0);
    const workWarning = queued > 0
      ? ` ${queued} queued operation(s) will be left unassigned.`
      : "";
    if (!confirm(`Delete workstation ${machine.code} — ${machine.name}?${workWarning} Any linked CMMS asset and its maintenance history will be kept, but detached from this workstation.`)) return;

    setDeletingId(machine.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/machines/${machine.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not delete workstation (${response.status}).`);
      if (editingId === machine.id) setEditingId(null);
      setNotice(`${machine.code} deleted. Linked CMMS asset history was retained.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete workstation.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="space-y-5 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black text-white"><Cpu className="h-5 w-5 text-amber-400" /> Workstation setup</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            Workstations are the same production-machine records used by Operator Station. To avoid retyping plant-asset details, select an unlinked CMMS asset below; its identity and location are copied into the workstation and both records are linked. CMMS keeps its own maintenance history and technical details.
          </p>
        </div>
        <button type="button" onClick={() => { void load(); void loadPlantAssets(); }} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </header>

      {(error || notice) && (
        <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold ${error ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>
          {error ? <Wrench className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {error || notice}
        </div>
      )}

      <form onSubmit={addWorkstation} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4 sm:grid-cols-2 xl:grid-cols-6">
        <label className="text-[11px] font-bold text-slate-400">Create from plant asset (optional)
          <select value={selectedAssetId} onChange={(event) => selectPlantAsset(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-white focus:border-amber-500 focus:outline-none">
            <option value="">Enter workstation details manually (or add a CMMS asset first)</option>
            {plantAssets.filter((asset) => !asset.machineId).map((asset) => <option key={asset.id} value={asset.id}>{asset.assetTag} — {asset.name}</option>)}
          </select>
        </label>
        <label className="text-[11px] font-bold text-slate-400">Workstation code
          <input value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} maxLength={32} placeholder="e.g. CNC-01" className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-mono font-bold text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none" />
        </label>
        <label className="text-[11px] font-bold text-slate-400">Workstation name
          <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={120} placeholder="e.g. CNC Router 1" className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none" />
        </label>
        <label className="text-[11px] font-bold text-slate-400">Machine category
          <input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} maxLength={80} placeholder="e.g. CNC Router" className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none" />
        </label>
        <label className="text-[11px] font-bold text-slate-400">Location
          <input value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} maxLength={120} placeholder="e.g. Bay A" className="mt-1.5 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-semibold text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none" />
        </label>
        <div className="flex items-end">
          <button type="submit" disabled={saving} className="flex w-full items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2.5 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-50">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add workstation
          </button>
        </div>
        {selectedAssetId && <p className="sm:col-span-2 xl:col-span-6 text-[11px] text-emerald-300">Name, category, location, and code were filled from the selected CMMS asset. You can adjust them before saving; the new production machine will be linked to that asset.</p>}
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        {loading && workstations.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading workstations…</div>
        ) : workstations.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">No workstations registered yet.</div>
        ) : (
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="bg-slate-950 text-[10px] uppercase tracking-wider text-slate-500">
              <tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">Workstation</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Actions</th></tr>
            </thead>
            <tbody>{workstations.map((machine) => (
              <Fragment key={machine.id}>
                <tr className="border-t border-slate-800/70 text-slate-300">
                  <td className="px-4 py-3 font-mono font-black text-amber-300">{machine.code}</td>
                  <td className="px-4 py-3 font-bold text-white">{machine.name}</td>
                  <td className="px-4 py-3">{machine.category}</td>
                  <td className="px-4 py-3">{machine.location}</td>
                  <td className="px-4 py-3"><span className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-bold">{machine.status}</span></td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button type="button" onClick={() => beginEdit(machine)} disabled={saving || deletingId === machine.id} className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[10px] font-bold text-slate-300 hover:text-white disabled:opacity-50"><Pencil className="h-3 w-3" /> Edit</button>
                      <button type="button" onClick={() => void deleteWorkstation(machine)} disabled={saving || deletingId === machine.id} className="flex items-center gap-1 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-[10px] font-bold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50">{deletingId === machine.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Delete</button>
                    </div>
                  </td>
                </tr>
                {editingId === machine.id && (
                  <tr key={`${machine.id}-edit`} className="border-t border-slate-800/70">
                    <td colSpan={6} className="p-3">
                      <form onSubmit={updateWorkstation} className="grid grid-cols-1 gap-3 rounded-xl border border-amber-500/30 bg-slate-950/70 p-4 sm:grid-cols-2 xl:grid-cols-6">
                        <label className="text-[10px] font-bold text-slate-400">Code<input value={editForm.code} onChange={(event) => setEditForm({ ...editForm, code: event.target.value })} maxLength={32} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-mono font-bold text-white focus:border-amber-500 focus:outline-none" /></label>
                        <label className="text-[10px] font-bold text-slate-400">Name<input value={editForm.name} onChange={(event) => setEditForm({ ...editForm, name: event.target.value })} maxLength={120} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-semibold text-white focus:border-amber-500 focus:outline-none" /></label>
                        <label className="text-[10px] font-bold text-slate-400">Category<input value={editForm.category} onChange={(event) => setEditForm({ ...editForm, category: event.target.value })} maxLength={80} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-semibold text-white focus:border-amber-500 focus:outline-none" /></label>
                        <label className="text-[10px] font-bold text-slate-400">Location<input value={editForm.location} onChange={(event) => setEditForm({ ...editForm, location: event.target.value })} maxLength={120} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-semibold text-white focus:border-amber-500 focus:outline-none" /></label>
                        <label className="text-[10px] font-bold text-slate-400">Status<select value={editForm.status} onChange={(event) => setEditForm({ ...editForm, status: event.target.value })} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-xs font-semibold text-white focus:border-amber-500 focus:outline-none"><option>Active</option><option>Maintenance</option><option>Offline</option></select></label>
                        <div className="flex items-end gap-2">
                          <button type="submit" disabled={saving} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-amber-500 px-3 py-2 text-[10px] font-black text-slate-950 hover:bg-amber-400 disabled:opacity-50">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save</button>
                          <button type="button" onClick={() => setEditingId(null)} disabled={saving} aria-label="Cancel workstation edit" className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:text-white disabled:opacity-50"><X className="h-3.5 w-3.5" /></button>
                        </div>
                      </form>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}</tbody>
          </table>
        )}
      </div>
    </section>
  );
}
