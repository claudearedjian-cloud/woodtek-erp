"use client";

// Manager-only "Import clients from Excel" panel (System Settings → Import clients).
// Flow: download the template → choose the filled .xlsx → Check file (preview,
// row by row) → Import (only when the file has no error rows). Existing clients
// are skipped, never changed.

import React, { useState } from "react";
import { FileSpreadsheet, Download, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";

type PlanRow = { rowNumber: number; action: "create" | "exists" | "error"; name: string; company: string; email: string; reason: string };
type Plan = {
  valid: boolean;
  headerError: string;
  rows: PlanRow[];
  createCount: number;
  existsCount: number;
  errorCount: number;
  inserted?: number;
};

export default function ClientImportPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "commit">("");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const send = async (mode: "preview" | "commit") => {
    if (!file) return;
    setBusy(mode);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("mode", mode);
      const res = await fetch("/api/customers/import", { method: "POST", body: form, cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (mode === "preview") {
        if (!res.ok) {
          setPlan(null);
          setMessage({ kind: "error", text: data.error || "The file could not be checked." });
          return;
        }
        setPlan(data as Plan);
        if (data.headerError) setMessage({ kind: "error", text: data.headerError });
        return;
      }
      if (!res.ok) {
        if (data.rows) setPlan(data as Plan);
        setMessage({ kind: "error", text: data.error || "Nothing was imported. Fix the rows marked as errors and check the file again." });
        return;
      }
      setPlan(data as Plan);
      setMessage({
        kind: "ok",
        text: `Imported ${data.inserted ?? 0} client(s). ${data.existsCount} already existed and were skipped. They are shared clients until a Manager assigns them to a rep.`,
      });
    } catch {
      setMessage({ kind: "error", text: "Could not reach the server. Nothing was imported; check the client list before trying again." });
    } finally {
      setBusy("");
    }
  };

  const shown = plan?.rows.slice(0, 60) ?? [];

  return (
    <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4">
      <h3 className="flex items-center gap-2 text-sm font-black text-white">
        <FileSpreadsheet className="h-4 w-4 text-emerald-400" /> Import clients from Excel
      </h3>
      <p className="mt-1 text-xs text-slate-400">
        Fill the WoodTek template (one client per row; Name is required), then check the file. Existing clients
        (same email, or same name and company when there is no email) are skipped and never changed.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <a
          href="/api/customers/import"
          download
          className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:text-white"
        >
          <Download className="h-3.5 w-3.5" /> Download template
        </a>
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPlan(null); setMessage(null); }}
          className="text-[11px] text-slate-300 file:mr-2 file:rounded-lg file:border-0 file:bg-slate-800 file:px-3 file:py-1.5 file:text-[11px] file:font-bold file:text-white"
        />
        <button
          type="button"
          onClick={() => void send("preview")}
          disabled={!file || busy !== ""}
          className="rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-black text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {busy === "preview" ? "Checking…" : "Check file"}
        </button>
        <button
          type="button"
          onClick={() => void send("commit")}
          disabled={!plan || !plan.valid || plan.createCount === 0 || busy !== ""}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-emerald-500 disabled:opacity-40"
        >
          {busy === "commit" ? "Importing…" : `Import ${plan?.createCount ?? 0} client(s)`}
        </button>
      </div>

      {busy && (
        <div className="mt-3 flex items-center gap-2 text-xs text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Working…</div>
      )}

      {plan && !plan.headerError && (
        <div className="mt-3">
          <div className="flex flex-wrap gap-3 text-xs font-bold">
            <span className="text-emerald-300">{plan.createCount} to create</span>
            <span className="text-slate-400">{plan.existsCount} already exist (skipped)</span>
            <span className={plan.errorCount ? "text-rose-300" : "text-slate-500"}>{plan.errorCount} with errors</span>
          </div>
          <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-slate-800">
            <table className="w-full text-left text-[11px]">
              <thead className="sticky top-0 bg-slate-950 text-slate-400">
                <tr><th className="px-2 py-1">Row</th><th className="px-2 py-1">Name</th><th className="px-2 py-1">Company</th><th className="px-2 py-1">Email</th><th className="px-2 py-1">Result</th></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.rowNumber} className="border-t border-slate-800 text-slate-200">
                    <td className="px-2 py-1">{r.rowNumber}</td>
                    <td className="px-2 py-1">{r.name}</td>
                    <td className="px-2 py-1">{r.company}</td>
                    <td className="px-2 py-1">{r.email}</td>
                    <td className={`px-2 py-1 ${r.action === "error" ? "text-rose-300" : r.action === "exists" ? "text-slate-500" : "text-emerald-300"}`}>
                      {r.action === "create" ? "Will be created" : r.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {plan.rows.length > shown.length && (
            <p className="mt-1 text-[11px] text-slate-500">Showing the first {shown.length} of {plan.rows.length} rows.</p>
          )}
          {plan.errorCount > 0 && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-rose-300"><AlertTriangle className="h-3.5 w-3.5" /> Fix the rows with errors in the file and check it again. Nothing is imported while errors remain.</p>
          )}
        </div>
      )}

      {message && (
        <div className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${message.kind === "ok" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}`}>
          {message.kind === "ok" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
          <span>{message.text}</span>
        </div>
      )}
    </div>
  );
}
