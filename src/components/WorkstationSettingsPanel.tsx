"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CheckCircle2, Cpu, Loader2, Plus, RefreshCw, Wrench } from "lucide-react";

interface Workstation {
  id: number;
  code: string;
  name: string;
  category: string;
  location: string;
  status: string;
}

const EMPTY_FORM = { code: "", name: "", category: "CNC Router", location: "Shop Floor" };

export default function WorkstationSettingsPanel() {
  const [workstations, setWorkstations] = useState<Workstation[]>([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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

  useEffect(() => { void load(); }, [load]);

  const addWorkstation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = form.code.trim().toUpperCase();
    const name = form.name.trim();
    const category = form.category.trim();
    const location = form.location.trim();
    if (!code || !name || !category || !location) {
      setError("Enter a workstation code, name, category, and location.");
      return;
    }
    if (workstations.some((machine) => machine.code.toUpperCase() === code)) {
      setError(`Workstation code ${code} already exists.`);
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/machines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name,
          category,
          location,
          status: "Active",
          hourlyCost: "0.00",
          assignedOperatorIds: [],
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Could not add workstation (${response.status}).`);
      setForm(EMPTY_FORM);
      setNotice(`${code} added. It is now available in Operator Station and in CMMS machine-link choices.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add workstation.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h2 className="flex items-center gap-2 text-base font-black text-white"><Cpu className="h-5 w-5 text-amber-400" /> Workstation setup</h2>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            Workstations are the same production-machine records used by Operator Station. They are not duplicated in CMMS.
            Link a CMMS asset to one of these records using its “Linked Production Machine” field.
          </p>
        </div>
        <button type="button" onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </button>
      </header>

      {(error || notice) && (
        <div className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-xs font-bold ${error ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>
          {error ? <Wrench className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
          {error || notice}
        </div>
      )}

      <form onSubmit={addWorkstation} className="grid grid-cols-1 gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4 sm:grid-cols-2 xl:grid-cols-5">
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
      </form>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        {loading && workstations.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading workstations…</div>
        ) : workstations.length === 0 ? (
          <div className="py-10 text-center text-xs text-slate-500">No workstations registered yet.</div>
        ) : (
          <table className="w-full min-w-[620px] text-left text-xs">
            <thead className="bg-slate-950 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Code</th><th className="px-4 py-3">Workstation</th><th className="px-4 py-3">Category</th><th className="px-4 py-3">Location</th><th className="px-4 py-3">Status</th></tr></thead>
            <tbody>{workstations.map((machine) => (
              <tr key={machine.id} className="border-t border-slate-800/70 text-slate-300">
                <td className="px-4 py-3 font-mono font-black text-amber-300">{machine.code}</td>
                <td className="px-4 py-3 font-bold text-white">{machine.name}</td>
                <td className="px-4 py-3">{machine.category}</td>
                <td className="px-4 py-3">{machine.location}</td>
                <td className="px-4 py-3"><span className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-[10px] font-bold">{machine.status}</span></td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </section>
  );
}
