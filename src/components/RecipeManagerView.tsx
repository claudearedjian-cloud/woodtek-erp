"use client";

import React, { useEffect, useState } from "react";
import {
  Workflow,
  Plus,
  Pencil,
  Trash2,
  X,
  ChevronUp,
  ChevronDown,
  Save,
  ArrowRight,
  AlertTriangle,
  CheckCircle2,
  Layers,
} from "lucide-react";

const BASE_CATEGORIES = ["Beam Saw", "Edge Bander", "CNC Router", "Press", "Assembly Table", "Drill Press", "Spray & Finish"];

type StepDraft = { operationName: string; machineCategory: string; estimatedMinutes: string };

interface RecipeManagerViewProps {
  onRefresh: () => void;
}

export default function RecipeManagerView({ onRefresh }: RecipeManagerViewProps) {
  const [recipes, setRecipes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [editing, setEditing] = useState<{ id?: number; name: string; description: string; steps: StepDraft[] } | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchRecipes = async () => {
    try {
      const res = await fetch("/api/templates", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load recipes.");
      setRecipes(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load recipes.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchRecipes(); }, []);

  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(""), 4000); };

  const openNew = () => {
    setEditing({ name: "", description: "", steps: [{ operationName: "Beam Saw Cutting", machineCategory: "Beam Saw", estimatedMinutes: "90" }] });
    setError("");
  };

  const openEdit = (r: any) => {
    setEditing({
      id: r.id,
      name: r.name,
      description: r.description || "",
      steps: (Array.isArray(r.defaultStepsJson) ? r.defaultStepsJson : []).map((s: any) => ({
        operationName: s.operationName || "",
        machineCategory: s.machineCategory || "Beam Saw",
        estimatedMinutes: String(s.estimatedMinutes || 60),
      })),
    });
    setError("");
  };

  const addStep = () => setEditing(e => e ? { ...e, steps: [...e.steps, { operationName: "", machineCategory: "Beam Saw", estimatedMinutes: "60" }] } : e);
  const removeStep = (i: number) => setEditing(e => e ? { ...e, steps: e.steps.filter((_, idx) => idx !== i) } : e);
  const moveStep = (i: number, dir: -1 | 1) => setEditing(e => {
    if (!e) return e;
    const j = i + dir;
    if (j < 0 || j >= e.steps.length) return e;
    const steps = [...e.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    return { ...e, steps };
  });
  const updateStep = (i: number, field: keyof StepDraft, val: string) => setEditing(e => e ? {
    ...e,
    steps: e.steps.map((s, idx) => idx === i ? { ...s, [field]: val } : s),
  } : e);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const validSteps = editing.steps.filter(s => s.operationName.trim());
    if (!editing.name.trim() || validSteps.length === 0) {
      setError("Give the recipe a name and at least one named step.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const body = {
        name: editing.name.trim(),
        description: editing.description,
        defaultStepsJson: validSteps.map((s, i) => ({
          stepOrder: i + 1,
          operationName: s.operationName.trim(),
          machineCategory: s.machineCategory,
          estimatedMinutes: Number(s.estimatedMinutes) || 60,
        })),
      };
      const res = await fetch(editing.id ? `/api/templates/${editing.id}` : "/api/templates", {
        method: editing.id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p.error || "Failed to save recipe");
      }
      setEditing(null);
      flash(editing.id ? "Recipe updated." : "Recipe created.");
      await fetchRecipes();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save recipe");
    } finally {
      setSaving(false);
    }
  };

  const del = async (r: any) => {
    if (!confirm(`Delete recipe "${r.name}"? Existing orders keep their own steps.`)) return;
    try {
      const res = await fetch(`/api/templates/${r.id}`, { method: "DELETE" });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p.error || "Failed to delete");
      }
      flash("Recipe deleted.");
      await fetchRecipes();
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete recipe");
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-amber-500/15 p-2.5 text-amber-400"><Workflow className="h-6 w-6" /></div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-white sm:text-2xl">Routing Recipes</h1>
            <p className="text-xs text-slate-400">One-click machine sequences (cut / edge / CNC / press) used when entering orders.</p>
          </div>
        </div>
        <button onClick={openNew} className="flex items-center gap-1.5 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-4 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-amber-950/40 ring-1 ring-inset ring-amber-300/40 transition hover:from-amber-300 hover:to-amber-500">
          <Plus className="h-4 w-4 stroke-[2.5]" /> New Recipe
        </button>
      </div>

      {(error || notice) && (
        <div className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-xs font-bold ${error ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>
          <span className="flex items-center gap-2">{error ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{error || notice}</span>
          <button onClick={() => { setError(""); setNotice(""); }} className="rounded-lg p-1 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 animate-pulse">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-40 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />)}
        </div>
      ) : recipes.length === 0 ? (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-14 text-center">
          <Workflow className="mx-auto mb-4 h-12 w-12 stroke-[1.5] text-slate-600" />
          <h3 className="text-base font-bold text-white">No recipes yet</h3>
          <p className="mt-1 text-xs text-slate-400">Create your first routing recipe — e.g. "Cutting + Edging + 36mm Pressing".</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {recipes.map(r => {
            const steps = Array.isArray(r.defaultStepsJson) ? r.defaultStepsJson : [];
            return (
              <div key={r.id} className="flex flex-col justify-between rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm transition hover:border-amber-500/40">
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-base font-black text-white">{r.name}</h3>
                    <div className="flex shrink-0 items-center gap-1">
                      <button onClick={() => openEdit(r)} title="Edit" className="rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-800 hover:text-amber-400"><Pencil className="h-4 w-4" /></button>
                      <button onClick={() => del(r)} title="Delete" className="rounded-lg p-1.5 text-slate-600 transition hover:bg-rose-500/20 hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                  {r.description && <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{r.description}</p>}
                  <div className="mt-3 flex flex-wrap items-center gap-y-1.5">
                    {steps.map((s: any, i: number) => (
                      <React.Fragment key={i}>
                        <span className="rounded-lg border border-slate-700 bg-slate-950/70 px-2 py-1 text-[10px] font-bold text-amber-300">
                          {i + 1}. {s.operationName}
                        </span>
                        {i < steps.length - 1 && <ArrowRight className="mx-1 h-3 w-3 shrink-0 text-slate-600" />}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
                <div className="mt-3 border-t border-slate-800 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {steps.length} step{steps.length === 1 ? "" : "s"} · category-based
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Editor modal */}
      {editing && (
        <div className="modal-backdrop fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto p-4 backdrop-blur-md sm:items-center">
          <form onSubmit={save} className="my-8 w-full max-w-2xl space-y-4 rounded-2xl border border-slate-700/80 bg-slate-900 p-6 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h3 className="flex items-center gap-2 text-lg font-black text-white">
                <Layers className="h-5 w-5 text-amber-400" /> {editing.id ? "Edit Recipe" : "New Recipe"}
              </h3>
              <button type="button" onClick={() => setEditing(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-300">Recipe name *</label>
              <input type="text" value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="e.g. Cutting + Edging + 36mm Pressing" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white" />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-300">Description</label>
              <input type="text" value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })}
                placeholder="Short note on when to use this flow" className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white" />
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-bold text-slate-300">Steps (in sequence)</label>
                <button type="button" onClick={addStep} className="flex items-center gap-1 text-[11px] font-bold text-amber-400 hover:text-amber-300">
                  <Plus className="h-3.5 w-3.5" /> Add step
                </button>
              </div>
              <div className="space-y-2.5 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                {editing.steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 p-2">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-xs font-black text-amber-400">{i + 1}</span>
                    <input type="text" value={s.operationName} onChange={e => updateStep(i, "operationName", e.target.value)}
                      placeholder="Operation name" className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white" />
                    <select value={s.machineCategory} onChange={e => updateStep(i, "machineCategory", e.target.value)}
                      className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white">
                      {BASE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      {!BASE_CATEGORIES.includes(s.machineCategory) && <option value={s.machineCategory}>{s.machineCategory}</option>}
                    </select>
                    <input type="number" value={s.estimatedMinutes} onChange={e => updateStep(i, "estimatedMinutes", e.target.value)}
                      className="w-16 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-center font-mono text-xs text-white" title="Estimated minutes" />
                    <div className="flex flex-col">
                      <button type="button" onClick={() => moveStep(i, -1)} disabled={i === 0} className="p-0.5 text-slate-500 hover:text-amber-400 disabled:opacity-30"><ChevronUp className="h-3.5 w-3.5" /></button>
                      <button type="button" onClick={() => moveStep(i, 1)} disabled={i === editing.steps.length - 1} className="p-0.5 text-slate-500 hover:text-amber-400 disabled:opacity-30"><ChevronDown className="h-3.5 w-3.5" /></button>
                    </div>
                    <button type="button" onClick={() => removeStep(i)} className="p-1.5 text-slate-500 transition hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
              <button type="button" onClick={() => setEditing(null)} className="rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-300 hover:bg-slate-700">Cancel</button>
              <button type="submit" disabled={saving} className="flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-2.5 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-50">
                <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save Recipe"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
