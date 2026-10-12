"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, FolderOpen, Pencil, RefreshCw, Save, Trash2, X } from "lucide-react";
import type { PolyboardProject } from "@/lib/polyboard";
import {
  ASSEMBLY_PROJECT_NAME_MAX,
  ASSEMBLY_PROJECT_NOTES_MAX,
  parseAssemblyProjectDetails,
  type AssemblyProjectDetails,
} from "@/lib/assemblyProject";

interface AssemblyProjectDialogProps {
  project: PolyboardProject;
  mode: "edit" | "delete";
  onClose: () => void;
  onSave: (details: AssemblyProjectDetails) => Promise<void>;
  onDelete: () => Promise<void>;
}

export default function AssemblyProjectDialog({
  project,
  mode,
  onClose,
  onSave,
  onDelete,
}: AssemblyProjectDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(project.name);
  const [notes, setNotes] = useState(project.notes || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const deleting = mode === "delete";
  const partCount = project.cabinets.reduce((sum, cabinet) => sum + cabinet.parts.length, 0);

  // Native modal dialogs trap focus, support Escape and restore focus on close.
  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError("");

    const parsed = parseAssemblyProjectDetails({ name, notes });
    if (!deleting && !parsed.ok) {
      setError(parsed.error);
      return;
    }

    setBusy(true);
    try {
      if (deleting) await onDelete();
      else if (parsed.ok) await onSave(parsed.details);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not update the project. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="assembly-project-dialog-title"
      aria-describedby="assembly-project-dialog-description"
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl border border-slate-700 bg-slate-900 p-5 sm:p-6 text-slate-100 shadow-2xl backdrop:bg-slate-950/80 backdrop:backdrop-blur-sm"
    >
      <form onSubmit={handleSubmit}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-5">
          <div className="flex items-center gap-3">
            <div className={`rounded-xl p-2 border ${deleting ? "border-rose-500/30 bg-rose-500/10 text-rose-400" : "border-amber-500/30 bg-amber-500/10 text-amber-400"}`}>
              {deleting ? <Trash2 className="w-5 h-5" /> : <Pencil className="w-5 h-5" />}
            </div>
            <h2 id="assembly-project-dialog-title" className="text-lg font-bold text-white">
              {deleting ? "Delete Project" : "Edit Project"}
            </h2>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Close project dialog"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p id="assembly-project-dialog-description" className="text-sm text-slate-400 mb-4">
          {deleting
            ? "Permanently remove this loaded project from Cabinet Assembly. This cannot be undone."
            : "Change the project name and notes. Cabinets, parts, CNC data, scan progress and ERP order links stay intact."}
        </p>

        {deleting ? (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/5 p-4">
            <div className="flex items-start gap-2 text-white font-bold break-words">
              <FolderOpen className="w-4 h-4 text-rose-400 mt-1 shrink-0" />
              <span>{project.name}</span>
            </div>
            <p className="mt-2 text-sm text-rose-200">
              {project.cabinets.length} cabinet{project.cabinets.length === 1 ? "" : "s"} and {partCount} part{partCount === 1 ? "" : "s"}, including their assembly progress and attached CNC data, will be removed.
            </p>
            <p className="mt-3 text-xs text-slate-400">
              Original Polyboard files and linked ERP orders will not be deleted.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <label htmlFor="assembly-project-name" className="block text-xs font-bold text-slate-300 mb-1.5">
                Project Name
              </label>
              <input
                id="assembly-project-name"
                type="text"
                required
                autoFocus
                maxLength={ASSEMBLY_PROJECT_NAME_MAX}
                disabled={busy}
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500 disabled:opacity-50"
              />
            </div>
            <div>
              <label htmlFor="assembly-project-notes" className="block text-xs font-bold text-slate-300 mb-1.5">
                Notes / Job Reference
              </label>
              <textarea
                id="assembly-project-notes"
                rows={4}
                maxLength={ASSEMBLY_PROJECT_NOTES_MAX}
                disabled={busy}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional notes or instructions for the assembly team…"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-500 disabled:opacity-50"
              />
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-300">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex justify-end gap-3 border-t border-slate-800 pt-4 mt-6">
          <button
            type="button"
            autoFocus={deleting}
            disabled={busy}
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || (!deleting && !name.trim())}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-50 ${deleting ? "bg-rose-600 text-white hover:bg-rose-700" : "bg-amber-500 text-slate-950 hover:bg-amber-600"}`}
          >
            {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : deleting ? <Trash2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
            {busy ? (deleting ? "Deleting…" : "Saving…") : (deleting ? "Delete Project" : "Save Changes")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
