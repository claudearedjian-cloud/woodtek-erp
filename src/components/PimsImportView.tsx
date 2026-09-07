"use client";

import React, { useEffect, useState } from "react";
import {
  FileInput,
  FolderOpen,
  RefreshCw,
  Save,
  Plus,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Import,
  ArrowRight,
  ExternalLink,
  X,
} from "lucide-react";

interface PimsImportViewProps {
  onSelectOrder: (orderId: number) => void;
}

const MACHINE_CATEGORIES = ["Beam Saw", "Edge Bander", "CNC Router", "Press", "Assembly Table", "Drill Press", "Spray & Finish"];

export default function PimsImportView({ onSelectOrder }: PimsImportViewProps) {
  const [folderPath, setFolderPath] = useState("");
  const [serviceMap, setServiceMap] = useState<Record<string, { operationName: string; machineCategory: string }>>({});
  const [imports, setImports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pastedXml, setPastedXml] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newCode, setNewCode] = useState("");
  const [scanResult, setScanResult] = useState<any>(null);

  const fetchState = async () => {
    try {
      const res = await fetch("/api/pims", { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to load PIMS bridge.");
      const data = await res.json();
      setFolderPath(data.settings.folderPath || "");
      setServiceMap(data.settings.serviceMap || {});
      setImports(data.imports || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load PIMS bridge.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchState(); }, []);

  const flash = (msg: string) => { setNotice(msg); setTimeout(() => setNotice(""), 4000); };

  const saveSettings = async () => {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/pims/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderPath, serviceMap }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to save settings");
      flash("Settings saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const scanFolder = async () => {
    setScanning(true);
    setError("");
    setScanResult(null);
    try {
      const res = await fetch("/api/pims/scan", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Scan failed");
      setScanResult(payload);
      await fetchState();
      const imported = payload.results.filter((r: any) => r.status === "imported").length;
      const skipped = payload.results.filter((r: any) => r.status === "skipped").length;
      flash(`Scanned ${payload.scanned} file(s): ${imported} imported, ${skipped} skipped.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
    } finally {
      setScanning(false);
    }
  };

  const importPasted = async () => {
    if (!pastedXml.trim()) { setError("Paste the PIMS invoice XML first."); return; }
    setImporting(true);
    setError("");
    try {
      const res = await fetch("/api/pims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ xml: pastedXml, fileName: "manual-paste.xml" }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Import failed");
      setScanResult({ scanned: 1, results: [payload] });
      setPastedXml("");
      await fetchState();
      flash(payload.status === "imported" ? `Imported → ${payload.orderNumber}` : payload.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const setMapEntry = (code: string, field: "operationName" | "machineCategory", val: string) =>
    setServiceMap(s => ({ ...s, [code]: { ...(s[code] || { operationName: "", machineCategory: "Beam Saw" }), [field]: val } }));
  const removeMapEntry = (code: string) =>
    setServiceMap(s => { const c = { ...s }; delete c[code]; return c; });
  const addMapEntry = () => {
    const code = newCode.trim().toUpperCase();
    if (!code) return;
    setServiceMap(s => ({ ...s, [code]: s[code] || { operationName: "", machineCategory: "Beam Saw" } }));
    setNewCode("");
  };

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-500/15 p-2.5 text-blue-400"><Import className="h-6 w-6" /></div>
          <div>
            <h1 className="text-xl font-black tracking-tight text-white sm:text-2xl">PIMS Invoice Bridge</h1>
            <p className="text-xs text-slate-400">Import PIMS sales invoices and turn them into tracked production orders.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={scanFolder} disabled={scanning} className="flex items-center gap-2 rounded-xl bg-blue-500 px-4 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-blue-600/30 transition hover:bg-blue-400 disabled:opacity-50">
            <FolderOpen className="h-4 w-4" /> {scanning ? "Scanning…" : "Scan Folder Now"}
          </button>
        </div>
      </div>

      {(error || notice) && (
        <div className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-xs font-bold ${error ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>
          <span className="flex items-center gap-2">{error ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{error || notice}</span>
          <button onClick={() => { setError(""); setNotice(""); }} className="rounded-lg p-1 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
      )}

      {loading ? (
        <div className="h-64 animate-pulse rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />
      ) : (
        <>
          {/* Folder + service map */}
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-4 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-black text-white">Export folder</h3>
              </div>
              <p className="text-[11px] leading-relaxed text-slate-400">
                The folder PIMS writes its invoice XML files to. Click <strong>Scan Folder Now</strong> to import every new file (processed files move to a <code className="text-amber-300">processed</code> subfolder).
              </p>
              <input
                type="text"
                value={folderPath}
                onChange={e => setFolderPath(e.target.value)}
                placeholder="e.g. C:\PIMS\Export  or  \\server\pims\export"
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 font-mono text-xs text-white placeholder-slate-500 focus:border-amber-500 focus:outline-none"
              />
            </div>

            <div className="space-y-3 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileInput className="h-4 w-4 text-amber-400" />
                  <h3 className="text-sm font-black text-white">Service code map</h3>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newCode}
                    onChange={e => setNewCode(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addMapEntry()}
                    placeholder="SER.02"
                    className="w-24 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 font-mono text-xs uppercase text-white"
                  />
                  <button onClick={addMapEntry} className="rounded-lg bg-slate-800 p-1.5 text-amber-400 hover:bg-slate-700"><Plus className="h-4 w-4" /></button>
                </div>
              </div>
              <p className="text-[11px] text-slate-400">Each <code className="text-amber-300">SER.xx</code> code maps to a machine step. Unmapped codes still become steps (unassigned).</p>
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1 custom-scrollbar">
                {Object.entries(serviceMap).length === 0 ? (
                  <p className="py-4 text-center text-xs italic text-slate-500">No codes mapped yet — add SER.01 → Beam Saw Cutting.</p>
                ) : (
                  Object.entries(serviceMap).map(([code, m]) => (
                    <div key={code} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-2">
                      <span className="w-16 shrink-0 font-mono text-[11px] font-black text-amber-400">{code}</span>
                      <input
                        type="text"
                        value={m.operationName}
                        onChange={e => setMapEntry(code, "operationName", e.target.value)}
                        placeholder="Step name"
                        className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                      />
                      <select
                        value={m.machineCategory}
                        onChange={e => setMapEntry(code, "machineCategory", e.target.value)}
                        className="w-36 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-white"
                      >
                        {MACHINE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <button onClick={() => removeMapEntry(code)} className="p-1.5 text-slate-500 transition hover:text-rose-400"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Save settings */}
          <div className="flex items-center gap-3">
            <button onClick={saveSettings} disabled={saving} className="flex items-center gap-2 rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-5 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-amber-950/40 transition hover:from-amber-300 hover:to-amber-500 disabled:opacity-50">
              <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save Settings"}
            </button>
          </div>

          {/* Manual paste import */}
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
            <h3 className="mb-2 text-sm font-black text-white">Manual import (paste one invoice XML)</h3>
            <textarea
              value={pastedXml}
              onChange={e => setPastedXml(e.target.value)}
              placeholder={"<TRANSACTIONTYPE>Sales Invoice</TRANSACTIONTYPE>\n…"}
              className="h-40 w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-[11px] text-white placeholder-slate-600 focus:border-amber-500 focus:outline-none"
            />
            <button onClick={importPasted} disabled={importing} className="mt-3 flex items-center gap-2 rounded-xl bg-blue-500 px-5 py-2.5 text-xs font-black text-slate-950 transition hover:bg-blue-400 disabled:opacity-50">
              <Import className="h-4 w-4" /> {importing ? "Importing…" : "Import Invoice"}
            </button>
          </div>

          {/* Scan result */}
          {scanResult && (
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
              <h3 className="mb-3 text-sm font-black text-white">Last scan result</h3>
              <div className="space-y-2">
                {scanResult.results.map((r: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <div className="min-w-0">
                      <span className="font-mono text-xs font-black text-slate-200">{r.file}</span>
                      <div className="text-[11px] text-slate-400">
                        {r.status === "imported" && <>Invoice {r.invoiceNumber} → <span className="text-emerald-300">{r.orderNumber}</span> · {r.operations} steps</>}
                        {r.status === "skipped" && <span className="text-amber-300">{r.message}</span>}
                        {r.status === "error" && <span className="text-rose-300">{r.message}</span>}
                      </div>
                    </div>
                    {r.status === "imported" && (
                      <button onClick={() => onSelectOrder(r.orderId)} className="flex shrink-0 items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-bold text-amber-300 hover:bg-slate-700">
                        Open order <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Import log */}
          <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-black text-white">Import history</h3>
              <button onClick={fetchState} className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-slate-300 hover:text-white"><RefreshCw className="h-4 w-4" /></button>
            </div>
            {imports.length === 0 ? (
              <p className="py-6 text-center text-xs italic text-slate-500">Nothing imported yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="px-3 py-2">Invoice</th>
                      <th className="px-3 py-2">Customer</th>
                      <th className="px-3 py-2">Order</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Imported</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {imports.map(im => (
                      <tr key={im.id} className="text-slate-200">
                        <td className="px-3 py-2 font-mono font-bold text-amber-400">{im.invoiceNumber}</td>
                        <td className="px-3 py-2">{im.customerName || "—"}</td>
                        <td className="px-3 py-2">
                          {im.orderId ? (
                            <button onClick={() => onSelectOrder(im.orderId)} className="font-mono text-blue-300 hover:underline">{im.orderNumber}</button>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2"><span className={`rounded px-2 py-0.5 text-[10px] font-bold ${im.status === "imported" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300"}`}>{im.status}</span></td>
                        <td className="px-3 py-2 text-slate-400">{new Date(im.importedAt).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
