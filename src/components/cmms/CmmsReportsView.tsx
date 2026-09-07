"use client";

import React, { useMemo, useState } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { FileDown, Eye, FileText, Download, Printer, AlertTriangle, CheckCircle2, X } from "lucide-react";

interface Props {
  assets: any[];
  locations: string[];
  currentUser: any;
}

const ASSET_TYPES = ["Generators", "CNC Routers", "Edge Banders", "Panel Saws", "Compressors", "Dust Extraction", "HVAC", "Spray & Finish"];

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function toCsv(rows: (string | number)[][]) {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\r\n");
}

export default function CmmsReportsView({ assets = [], locations = [], currentUser }: Props) {
  const [locationFilter, setLocationFilter] = useState("All Locations");
  const [typeFilter, setTypeFilter] = useState("All Machine Types");
  const [yearFilter, setYearFilter] = useState("All Production Years");
  const [selectedAssetId, setSelectedAssetId] = useState("");
  const [preview, setPreview] = useState<any>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const years = useMemo(() => {
    const set = new Set<string>();
    for (const a of assets) {
      if (a.installedAt) set.add(String(new Date(a.installedAt).getFullYear()));
    }
    return Array.from(set).sort().reverse();
  }, [assets]);

  const filtered = useMemo(
    () =>
      assets.filter((a) => {
        const matchLoc = locationFilter === "All Locations" || a.site === locationFilter;
        const matchType = typeFilter === "All Machine Types" || a.assetType === typeFilter;
        const matchYear =
          yearFilter === "All Production Years" ||
          (a.installedAt && String(new Date(a.installedAt).getFullYear()) === yearFilter);
        return matchLoc && matchType && matchYear;
      }),
    [assets, locationFilter, typeFilter, yearFilter],
  );

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(""), 4000);
  };

  const compileFleetPreview = () => {
    if (filtered.length === 0) {
      setError("No assets match the selected filters.");
      return;
    }
    setError("");
    setPreview({
      kind: "fleet",
      title: "Fleet Asset Status Report",
      subtitle: `${locationFilter} · ${typeFilter} · ${yearFilter}`,
      generatedAt: new Date(),
      rows: filtered,
      totals: {
        count: filtered.length,
        runtime: filtered.reduce((s, a) => s + (a.runtimeHours || 0), 0),
        overdue: filtered.filter((a) => a.isOverdue).length,
        due: filtered.filter((a) => a.isDue).length,
      },
    });
    flash("Fleet preview compiled.");
  };

  const exportFleetCsv = () => {
    if (filtered.length === 0) {
      setError("No assets match the selected filters.");
      return;
    }
    setError("");
    const rows: (string | number)[][] = [
      ["Asset Tag", "Name", "Brand", "Type", "Site", "Runtime Hrs", "Interval Hrs", "Since Service", "Service State", "Criticality", "Serial", "Power Status", "Rating kVA"],
      ...filtered.map((a) => [
        a.assetTag, a.name, a.brand, a.assetType, a.site,
        a.runtimeHours, a.serviceIntervalHours, a.sinceService,
        a.serviceState, a.criticality, a.serialNumber || "", a.powerStatus, a.ratingKva,
      ]),
    ];
    downloadBlob(toCsv(rows), `woodtek_fleet_${Date.now()}.csv`, "text/csv;charset=utf-8;");
    flash(`Exported ${filtered.length} asset row(s) to CSV.`);
  };

  const compileHistoryLog = async () => {
    if (!selectedAssetId) {
      setError("Select a specific unit asset first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/cmms?assetId=${selectedAssetId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Server returned status ${res.status}.`);
      const detail = await res.json();
      setPreview({
        kind: "history",
        title: "Isolated Asset Maintenance History",
        subtitle: `${detail.assetTag} — ${detail.name}`,
        generatedAt: new Date(),
        asset: detail,
        rows: detail.logs ?? [],
      });
      flash("History log compiled.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to compile history log.");
    } finally {
      setBusy(false);
    }
  };

  const exportLogsCsv = async () => {
    if (!selectedAssetId) {
      setError("Select a specific unit asset first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/cmms?assetId=${selectedAssetId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Server returned status ${res.status}.`);
      const detail = await res.json();
      const logs = detail.logs ?? [];
      if (logs.length === 0) {
        setError("This asset has no maintenance events to export.");
        return;
      }
      const rows: (string | number)[][] = [
        ["Date", "Event Type", "Description", "Meter Hrs", "Downtime Mins", "Parts Cost", "Labor Cost", "Technician", "Meter Reset"],
        ...logs.map((l: any) => [
          new Date(l.createdAt).toLocaleString(), l.eventType, l.description,
          l.runtimeAtEvent, l.downtimeMinutes, l.partsCost, l.laborCost,
          l.performedByName || "", l.resetService ? "Yes" : "No",
        ]),
      ];
      downloadBlob(toCsv(rows), `${detail.assetTag}_logs_${Date.now()}.csv`, "text/csv;charset=utf-8;");
      flash(`Exported ${logs.length} maintenance event(s).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to export logs.");
    } finally {
      setBusy(false);
    }
  };

  const savePdf = () => {
    if (!preview) return;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Plant Asset Analytics & CMMS", 14, 20);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(preview.title, 14, 30);
    doc.text(preview.subtitle, 14, 36);
    doc.text(`Generated: ${preview.generatedAt.toLocaleString()}  ·  By: ${currentUser?.name ?? "System"}`, 14, 42);

    if (preview.kind === "fleet") {
      autoTable(doc, {
        startY: 52,
        head: [["Tag", "Asset", "Brand", "Site", "Meter", "Since Svc", "State"]],
        body: preview.rows.map((a: any) => [
          a.assetTag, String(a.name).slice(0, 26), a.brand, a.site,
          `${a.runtimeHours}h`, `${a.sinceService}/${a.serviceIntervalHours}`, a.serviceState,
        ]),
        theme: "grid",
        headStyles: { fillColor: [34, 197, 94] },
        styles: { fontSize: 8 },
        didParseCell: (h) => {
          if (h.cell.raw === "Service Overdue") h.cell.styles.textColor = [220, 38, 38];
        },
      });
    } else {
      autoTable(doc, {
        startY: 52,
        head: [["Date", "Event", "Description", "Meter", "Cost"]],
        body: preview.rows.map((l: any) => [
          new Date(l.createdAt).toLocaleDateString(), l.eventType,
          String(l.description).slice(0, 48), `${l.runtimeAtEvent}h`,
          `$${(parseFloat(l.partsCost) + parseFloat(l.laborCost)).toFixed(2)}`,
        ]),
        theme: "grid",
        headStyles: { fillColor: [59, 130, 246] },
        styles: { fontSize: 8 },
      });
    }
    doc.save(`cmms_${preview.kind}_${Date.now()}.pdf`);
    flash("PDF saved.");
  };

  return (
    <div className="space-y-6">
      {/* Builder */}
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm print:hidden">
        <div className="border-b border-slate-800 pb-4">
          <h2 className="flex items-center gap-2 text-lg font-black text-white">
            <FileDown className="h-5 w-5 text-emerald-400" /> Custom Report Builder &amp; Data Export Engine
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">PDF &amp; Excel CSV Export Suite</p>
        </div>

        {(error || notice) && (
          <div className={`mt-4 flex items-center justify-between gap-3 rounded-xl border p-3 text-xs font-bold ${error ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>
            <span className="flex items-center gap-2">
              {error ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {error || notice}
            </span>
            <button onClick={() => { setError(""); setNotice(""); }} className="rounded-lg p-1 hover:bg-white/10"><X className="h-4 w-4" /></button>
          </div>
        )}

        <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-300">Filter by Location</label>
            <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none">
              <option>All Locations</option>
              {locations.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-300">Filter by Machine Type</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none">
              <option>All Machine Types</option>
              {ASSET_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-bold text-slate-300">Filter by Production Era</label>
            <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none">
              <option>All Production Years</option>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button onClick={exportFleetCsv} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700">
            <Download className="h-4 w-4" /> Export Fleet CSV / Excel
          </button>
          <button onClick={compileFleetPreview} className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-black text-slate-950 transition hover:bg-emerald-400">
            <Eye className="h-4 w-4" /> Compile Fleet Preview
          </button>
          <span className="text-[11px] font-semibold text-slate-500">{filtered.length} asset(s) match</span>
        </div>

        {/* Isolated single-asset report */}
        <div className="mt-6 border-t border-slate-800 pt-5">
          <h3 className="mb-3 text-sm font-black text-white">Isolated Single Machine Report</h3>
          <div className="flex flex-col gap-3 lg:flex-row">
            <select value={selectedAssetId} onChange={(e) => setSelectedAssetId(e.target.value)} className="flex-1 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none">
              <option value="">-- Select Specific Unit Asset --</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.assetTag} — {a.name}</option>)}
            </select>
            <div className="flex gap-3">
              <button onClick={exportLogsCsv} disabled={busy} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-50">
                <FileText className="h-4 w-4" /> Logs CSV
              </button>
              <button onClick={compileHistoryLog} disabled={busy} className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-xs font-black text-white transition hover:bg-blue-500 disabled:opacity-50">
                <FileText className="h-4 w-4" /> Compile History Log
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Document preview */}
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm print:border-0 print:bg-white print:p-0">
        <div className="flex items-center justify-between border-b border-slate-800 pb-4 print:hidden">
          <div>
            <h3 className="text-sm font-black text-white">Document Preview</h3>
            <p className="text-xs text-slate-400">Generated below. Ready for print or download.</p>
          </div>
          {preview && (
            <div className="flex gap-2">
              <button onClick={savePdf} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700">
                <Download className="h-4 w-4" /> Save as PDF
              </button>
              <button onClick={() => window.print()} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700">
                <Printer className="h-4 w-4" /> Print
              </button>
            </div>
          )}
        </div>

        {!preview ? (
          <p className="py-20 text-center text-xs italic text-slate-500">
            No report compiled yet. Select options above and click &quot;Compile Preview&quot;.
          </p>
        ) : (
          <div className="mt-5 rounded-xl bg-white p-6 text-slate-900 print:mt-0 print:rounded-none print:p-0">
            <div className="mb-5 border-b-2 border-emerald-500 pb-4">
              <h2 className="text-xl font-black">{preview.title}</h2>
              <p className="mt-0.5 text-xs text-slate-600">{preview.subtitle}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                Generated {preview.generatedAt.toLocaleString()} · By {currentUser?.name ?? "System"}
              </p>
            </div>

            {preview.kind === "fleet" ? (
              <>
                <div className="mb-4 grid grid-cols-4 gap-3">
                  <Stat label="Assets" value={String(preview.totals.count)} />
                  <Stat label="Total Runtime" value={`${preview.totals.runtime.toLocaleString()} h`} />
                  <Stat label="Service Due" value={String(preview.totals.due)} tone="text-amber-600" />
                  <Stat label="Overdue" value={String(preview.totals.overdue)} tone="text-rose-600" />
                </div>
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b-2 border-slate-200 text-[10px] font-bold uppercase text-slate-600">
                      <th className="py-2 px-2">Tag</th><th className="py-2 px-2">Asset</th><th className="py-2 px-2">Brand</th>
                      <th className="py-2 px-2">Site</th><th className="py-2 px-2 text-right">Meter</th>
                      <th className="py-2 px-2 text-right">Since Svc</th><th className="py-2 px-2">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((a: any) => (
                      <tr key={a.id} className="border-b border-slate-100 text-xs">
                        <td className="py-2 px-2 font-mono font-bold">{a.assetTag}</td>
                        <td className="py-2 px-2">{a.name}</td>
                        <td className="py-2 px-2 text-slate-600">{a.brand}</td>
                        <td className="py-2 px-2 text-slate-600">{a.site}</td>
                        <td className="py-2 px-2 text-right font-mono">{a.runtimeHours} h</td>
                        <td className="py-2 px-2 text-right font-mono">{a.sinceService}/{a.serviceIntervalHours}</td>
                        <td className="py-2 px-2">
                          <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${a.isOverdue ? "bg-rose-100 text-rose-700" : a.isDue ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                            {a.serviceState}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : (
              <>
                <div className="mb-4 grid grid-cols-4 gap-3">
                  <Stat label="Meter" value={`${preview.asset.runtimeHours} h`} />
                  <Stat label="Interval" value={`${preview.asset.serviceIntervalHours} h`} />
                  <Stat label="Events" value={String(preview.rows.length)} />
                  <Stat label="State" value={preview.asset.serviceState} tone={preview.asset.isOverdue ? "text-rose-600" : "text-emerald-600"} />
                </div>
                {preview.rows.length === 0 ? (
                  <p className="py-10 text-center text-xs italic text-slate-500">No maintenance events recorded for this asset.</p>
                ) : (
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b-2 border-slate-200 text-[10px] font-bold uppercase text-slate-600">
                        <th className="py-2 px-2">Date</th><th className="py-2 px-2">Event</th>
                        <th className="py-2 px-2">Description</th><th className="py-2 px-2 text-right">Meter</th>
                        <th className="py-2 px-2 text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.map((l: any) => (
                        <tr key={l.id} className="border-b border-slate-100 text-xs">
                          <td className="py-2 px-2 whitespace-nowrap">{new Date(l.createdAt).toLocaleDateString()}</td>
                          <td className="py-2 px-2 font-semibold">{l.eventType}</td>
                          <td className="py-2 px-2 text-slate-700">{l.description}</td>
                          <td className="py-2 px-2 text-right font-mono">{l.runtimeAtEvent} h</td>
                          <td className="py-2 px-2 text-right font-mono">${(parseFloat(l.partsCost) + parseFloat(l.laborCost)).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "text-slate-900" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-[10px] font-bold uppercase text-slate-500">{label}</div>
      <div className={`mt-0.5 text-lg font-black ${tone}`}>{value}</div>
    </div>
  );
}
