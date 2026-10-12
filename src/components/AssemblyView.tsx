"use client";

import React, { useState, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import {
  Box,
  Layers,
  UploadCloud,
  FileText,
  Cpu,
  Barcode,
  CheckCircle2,
  Clock,
  Sparkles,
  Search,
  Check,
  ChevronRight,
  Maximize2,
  Trash2,
  FileCode,
  AlertCircle,
  FolderOpen,
  ArrowRight,
  RefreshCw,
  Eye,
  Info,
  Printer,
  Wrench,
  Link as LinkIcon,
  PackageCheck,
  RotateCcw,
} from "lucide-react";
import type { PolyboardProject, PolyboardCabinet, PolyboardPart, PolyboardHardware } from "@/lib/polyboard";
import { SAMPLE_PB_PROJ, SAMPLE_CUTLIST_CSV, SAMPLE_CIX_FILES } from "@/lib/samplePolyboardData";
import { generatePartLabelsHtml } from "@/lib/partLabels";

// Dynamically import 3D Viewer to prevent SSR issues with WebGL/Three.js
const Cabinet3DViewer = dynamic(() => import("./Cabinet3DViewer"), {
  ssr: false,
  loading: () => (
    <div className="w-full h-[400px] flex items-center justify-center bg-slate-950/80 rounded-2xl border border-slate-800 text-slate-400">
      <div className="flex flex-col items-center gap-2">
        <RefreshCw className="w-6 h-6 animate-spin text-amber-500" />
        <span className="text-sm font-semibold">Initializing 3D WebGL Engine…</span>
      </div>
    </div>
  ),
});

export default function AssemblyView() {
  const [projects, setProjects] = useState<PolyboardProject[]>([]);
  const [activeProject, setActiveProject] = useState<PolyboardProject | null>(null);
  const [selectedCabinet, setSelectedCabinet] = useState<PolyboardCabinet | null>(null);
  const [selectedPart, setSelectedPart] = useState<PolyboardPart | null>(null);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [activeRightTab, setActiveRightTab] = useState<"parts" | "hardware">("parts");

  // Orders list for routing sync
  const [erpOrders, setErpOrders] = useState<Array<{ id: number; orderNumber: string; title?: string }>>([]);
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");

  // Scan input (barcode or manual CIX number)
  const [scanInput, setScanInput] = useState("");
  const [scanFeedback, setScanFeedback] = useState<{
    type: "success" | "error" | "info";
    message: string;
  } | null>(null);

  // Import Dialog State
  const [showImportModal, setShowImportModal] = useState(false);
  const [importProjName, setImportProjName] = useState("");
  const [csvFile, setCsvFile] = useState<{ name: string; content: string } | null>(null);
  const [pbProjFile, setPbProjFile] = useState<{ name: string; content: string } | null>(null);
  const [cixFilesList, setCixFilesList] = useState<Array<{ filename: string; content: string }>>([]);
  const [importNotes, setImportNotes] = useState("");
  const [importReport, setImportReport] = useState<{
    message: string;
    warnings: string[];
    details: Array<{ label: string; value: string }>;
  } | null>(null);

  const scanInputRef = useRef<HTMLInputElement>(null);

  // Fetch projects on load
  const loadProjects = async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/assembly");
      if (res.ok) {
        const data = await res.json();
        setProjects(data.projects || []);
        if (data.projects && data.projects.length > 0) {
          const first = data.projects[0];
          setActiveProject(first);
          if (first.cabinets && first.cabinets.length > 0) {
            setSelectedCabinet(first.cabinets[0]);
            if (first.cabinets[0].parts.length > 0) {
              setSelectedPart(first.cabinets[0].parts[0]);
            }
          }
        }
      }

      // Also fetch open ERP orders for routing synchronization
      const ordRes = await fetch("/api/orders");
      if (ordRes.ok) {
        const ordData = await ordRes.json();
        if (Array.isArray(ordData)) {
          setErpOrders(ordData);
        }
      }
    } catch (err) {
      console.error("Failed to load projects", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadProjects();
  }, []);

  // Update selected cabinet reference if activeProject updates
  useEffect(() => {
    if (activeProject && selectedCabinet) {
      const refreshed = activeProject.cabinets.find((c) => c.id === selectedCabinet.id);
      if (refreshed) {
        setSelectedCabinet(refreshed);
        if (selectedPart) {
          const refreshedPart = refreshed.parts.find((p) => p.id === selectedPart.id);
          setSelectedPart(refreshedPart || refreshed.parts[0] || null);
        }
      }
    }
  }, [activeProject]);

  // Handle Scanning or Manual Part CIX entry
  const handleScanSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!scanInput.trim() || !activeProject || !selectedCabinet) return;

    setScanning(true);
    setScanFeedback(null);

    try {
      const res = await fetch("/api/assembly/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProject.id,
          cabinetId: selectedCabinet.id,
          barcodeOrCixRef: scanInput.trim(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setScanFeedback({ type: "success", message: data.message });
        setScanInput("");
        if (data.project) {
          setActiveProject(data.project);
        }
        if (data.matchedPart) {
          setSelectedPart(data.matchedPart);
        }
      } else {
        setScanFeedback({
          type: "error",
          message: data.message || data.error || "Part scan failed.",
        });
      }
    } catch (err: any) {
      setScanFeedback({
        type: "error",
        message: err.message || "Network error while scanning part",
      });
    } finally {
      setScanning(false);
      setTimeout(() => scanInputRef.current?.focus(), 50);
    }
  };

  // Toggle single part directly by click
  const handleTogglePart = async (partId: string) => {
    if (!activeProject || !selectedCabinet) return;
    try {
      const res = await fetch("/api/assembly/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProject.id,
          cabinetId: selectedCabinet.id,
          action: "toggle",
          partId,
        }),
      });
      const data = await res.json();
      if (res.ok && data.project) {
        setActiveProject(data.project);
      }
    } catch (err) {
      console.error("Failed to toggle part", err);
    }
  };

  // Print Barcode Labels for the current cabinet
  const handlePrintLabels = async () => {
    if (!selectedCabinet) return;
    try {
      const html = await generatePartLabelsHtml(selectedCabinet, {
        companyName: "WoodTek CNC & Joinery",
        projectName: activeProject?.name || "Villa 42 Kitchen",
      });
      const printWindow = window.open("", "_blank", "width=850,height=900");
      if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
      } else {
        alert("Please enable pop-ups to print the part barcode labels.");
      }
    } catch (err) {
      console.error("Failed to generate labels", err);
      alert("Error generating labels");
    }
  };

  // Sync cabinet ready status with ERP Order routing
  const handleSyncToOrder = async (orderIdToSync: number) => {
    if (!activeProject || !selectedCabinet) return;
    try {
      const res = await fetch("/api/assembly/sync-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: activeProject.id,
          cabinetId: selectedCabinet.id,
          orderId: orderIdToSync,
        }),
      });
      const data = await res.json();
      if (res.ok && data.project) {
        setActiveProject(data.project);
        setScanFeedback({
          type: "success",
          message: `Linked cabinet to ERP Order #${orderIdToSync}.`,
        });
      }
    } catch (err) {
      console.error("Failed to sync with order", err);
    }
  };

  // Load Built-in Demo Polyboard Files into Import Modal
  const loadDemoFilesInModal = () => {
    setImportProjName("Villa 42 Kitchen Layout");
    setPbProjFile({ name: "Kitchen-Villa-42.pb-proj", content: SAMPLE_PB_PROJ });
    setCsvFile({ name: "Kitchen-Villa-42-cutlist.csv", content: SAMPLE_CUTLIST_CSV });
    const cixs = Object.entries(SAMPLE_CIX_FILES).map(([filename, content]) => ({
      filename,
      content,
    }));
    setCixFilesList(cixs);
    setImportNotes("Imported from Polyboard 7 CNC Biesse Rover A post-processor.");
  };

  // Submit Import
  const handleExecuteImport = async () => {
    if (!csvFile && !pbProjFile) {
      alert("Please upload at least a .csv or .pb-proj file.");
      return;
    }
    setImporting(true);
    try {
      const res = await fetch("/api/assembly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectName: importProjName,
          csvContent: csvFile?.content,
          csvFilename: csvFile?.name,
          pbProjContent: pbProjFile?.content,
          pbProjFilename: pbProjFile?.name,
          cixFiles: cixFilesList,
          notes: importNotes,
        }),
      });

      const data = await res.json();
      if (res.ok && data.project) {
        setShowImportModal(false);
        setCsvFile(null);
        setPbProjFile(null);
        setCixFilesList([]);
        setImportProjName("");

        // Read-back report: what the importer understood from the files
        const csvDiag = data.diagnostics?.csv;
        const cixDiag = data.diagnostics?.cix;
        const details: Array<{ label: string; value: string }> = [];
        if (csvDiag) {
          details.push({ label: "Separator", value: csvDiag.delimiterLabel });
          details.push({
            label: "Header row",
            value: csvDiag.headerless ? "not found (parsed by content)" : `line ${(csvDiag.headerRowIndex ?? 0) + 1}`,
          });
          const cols = Object.entries(csvDiag.detectedColumns || {})
            .filter(([role]) => !role.startsWith("edge"))
            .map(([role, label]) => `${role} ← ${label}`);
          if (cols.length > 0) details.push({ label: "Columns", value: cols.join(" • ") });
          details.push({
            label: "Cabinet split",
            value:
              csvDiag.cabinetGrouping === "single"
                ? "single cabinet (no cabinet field in the CSV)"
                : csvDiag.cabinetGrouping === "column"
                ? "by cabinet column"
                : csvDiag.cabinetGrouping === "sections"
                ? "by section headings"
                : "by repeated value blocks",
          });
          details.push({ label: "Rows", value: `${csvDiag.rowsParsed} parts parsed, ${csvDiag.rowsSkipped} skipped` });
        }
        if (cixDiag) {
          details.push({
            label: "CIX linking",
            value: `${cixDiag.matchedCount} part(s) linked to ${cixDiag.totalCix} file(s)${
              cixDiag.unmatchedCix?.length ? ` • not linked: ${cixDiag.unmatchedCix.length}` : ""
            }`,
          });
        }

        setImportReport({
          message: data.message || "Project imported.",
          warnings: data.diagnostics?.warnings || [],
          details,
        });

        await loadProjects();
        setActiveProject(data.project);
        if (data.project.cabinets?.[0]) {
          setSelectedCabinet(data.project.cabinets[0]);
          setSelectedPart(data.project.cabinets[0].parts?.[0] || null);
        }
      } else {
        alert(data.error || "Failed to import project");
      }
    } catch (err: any) {
      alert(err.message || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  // File Upload Handlers
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: "csv" | "pbproj" | "cix") => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (type === "csv") {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        setCsvFile({ name: file.name, content: event.target?.result as string });
        if (!importProjName) {
          setImportProjName(file.name.replace(/\.[^/.]+$/, ""));
        }
      };
      reader.readAsText(file);
    } else if (type === "pbproj") {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = (event) => {
        setPbProjFile({ name: file.name, content: event.target?.result as string });
        if (!importProjName) {
          setImportProjName(file.name.replace(/\.[^/.]+$/, ""));
        }
      };
      reader.readAsText(file);
    } else if (type === "cix") {
      const readPromises = Array.from(files).map(
        (f) =>
          new Promise<{ filename: string; content: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = (event) => {
              resolve({ filename: f.name, content: event.target?.result as string });
            };
            reader.readAsText(f);
          })
      );
      Promise.all(readPromises).then((results) => {
        setCixFilesList((prev) => [...prev, ...results]);
      });
    }
  };

  // Cabinet stats
  const totalParts = selectedCabinet?.parts.length || 0;
  const scannedParts = selectedCabinet?.parts.filter((p) => p.isScanned).length || 0;
  const progressPercent = totalParts > 0 ? Math.round((scannedParts / totalParts) * 100) : 0;
  const isCabinetReady = selectedCabinet?.isReadyForAssembly || (totalParts > 0 && scannedParts === totalParts);

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6 max-w-[1700px] mx-auto text-slate-100">
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800/80 pb-5">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400">
              <Box className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black tracking-tight text-white">
                  Cabinet Assembly & Polyboard Integration
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-sky-500/10 text-sky-400 border border-sky-500/30">
                  Biesse Rover A (CIX)
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Verify CNC parts via barcode scanner or CIX number, inspect in 3D, and validate ready cabinets for assembly.
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2.5">
          {projects.length > 0 && (
            <select
              value={activeProject?.id || ""}
              onChange={(e) => {
                const found = projects.find((p) => p.id === e.target.value);
                if (found) {
                  setActiveProject(found);
                  setSelectedCabinet(found.cabinets[0] || null);
                  setSelectedPart(found.cabinets[0]?.parts[0] || null);
                }
              }}
              className="bg-slate-900 border border-slate-700 text-sm font-semibold text-slate-200 rounded-xl px-3 py-2 outline-none focus:border-amber-500"
            >
              {projects.map((proj) => (
                <option key={proj.id} value={proj.id}>
                  📁 {proj.name} ({proj.cabinets.length} cabinets)
                </option>
              ))}
            </select>
          )}

          {selectedCabinet && (
            <button
              onClick={handlePrintLabels}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold px-3.5 py-2 rounded-xl text-sm border border-slate-700 transition"
              title="Print thermal barcodes for all parts in this cabinet"
            >
              <Printer className="w-4 h-4 text-sky-400" />
              Print Barcode Labels
            </button>
          )}

          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-bold px-4 py-2 rounded-xl text-sm shadow-lg shadow-amber-500/20 transition active:scale-95"
          >
            <UploadCloud className="w-4 h-4" />
            Import Polyboard Project
          </button>
        </div>
      </div>

      {/* Import Report: what the importer understood from the uploaded files */}
      {importReport && (
        <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-4 text-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 flex-1">
              <Info className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="text-sm font-bold text-white">{importReport.message}</div>

                {importReport.details.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {importReport.details.map((d) => (
                      <span
                        key={d.label}
                        className="bg-slate-900/80 border border-slate-700 rounded-lg px-2 py-1 text-[11px] text-slate-300"
                      >
                        <span className="text-slate-500">{d.label}: </span>
                        <span className="font-mono">{d.value}</span>
                      </span>
                    ))}
                  </div>
                )}

                {importReport.warnings.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1">
                    {importReport.warnings.map((w, i) => (
                      <li key={i} className="flex items-start gap-2 text-amber-300">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <button
              onClick={() => setImportReport(null)}
              className="text-slate-400 hover:text-white font-bold px-1"
              title="Dismiss import report"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace Layout */}
      {loading ? (
        <div className="h-96 flex items-center justify-center text-slate-400">
          <RefreshCw className="w-6 h-6 animate-spin text-amber-500 mr-2" />
          Loading Assembly Project Data…
        </div>
      ) : !activeProject ? (
        <div className="p-12 text-center bg-slate-900/40 rounded-3xl border border-dashed border-slate-800 flex flex-col items-center justify-center">
          <Box className="w-16 h-16 text-slate-600 mb-3" />
          <h3 className="text-lg font-bold text-white mb-1">No Assembly Projects Found</h3>
          <p className="text-sm text-slate-400 max-w-md mb-6">
            Import a Polyboard project containing your cabinet cutlist (.csv), project file (.pb-proj), and CNC Biesse Rover A (.cix) files.
          </p>
          <button
            onClick={() => setShowImportModal(true)}
            className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-5 py-2.5 rounded-xl text-sm transition"
          >
            Import Polyboard Files Now
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
          {/* Left Column: List of Cabinets (3 cols on xl) */}
          <div className="xl:col-span-3 flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <Layers className="w-4 h-4 text-amber-500" />
                Cabinets in Project ({activeProject.cabinets.length})
              </h2>
              <span className="text-xs text-slate-500">
                {activeProject.cabinets.filter((c) => c.isReadyForAssembly).length} / {activeProject.cabinets.length} Assembled
              </span>
            </div>

            <div className="flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-220px)] pr-1">
              {activeProject.cabinets.map((cab) => {
                const isSelected = selectedCabinet?.id === cab.id;
                const cTotal = cab.parts.length;
                const cScanned = cab.parts.filter((p) => p.isScanned).length;
                const isReady = cab.isReadyForAssembly || (cTotal > 0 && cScanned === cTotal);

                return (
                  <button
                    key={cab.id}
                    onClick={() => {
                      setSelectedCabinet(cab);
                      setSelectedPart(cab.parts[0] || null);
                      setScanFeedback(null);
                    }}
                    className={`w-full text-left p-3.5 rounded-2xl border transition relative overflow-hidden ${
                      isSelected
                        ? "bg-slate-800/90 border-amber-500 shadow-lg shadow-amber-500/10"
                        : "bg-slate-900/60 border-slate-800 hover:bg-slate-800/40 hover:border-slate-700"
                    }`}
                  >
                    <div
                      className={`absolute left-0 top-0 bottom-0 w-1.5 ${
                        isReady ? "bg-emerald-500" : cScanned > 0 ? "bg-amber-500" : "bg-slate-700"
                      }`}
                    />

                    <div className="pl-1">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <span className="font-bold text-white text-sm line-clamp-1">
                          {cab.name}
                        </span>
                        {isReady ? (
                          <span className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                            <Check className="w-3 h-3" /> Ready
                          </span>
                        ) : (
                          <span className="shrink-0 text-[11px] font-mono text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full">
                            {cScanned}/{cTotal} parts
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-slate-400 font-mono mb-2 flex items-center gap-2">
                        <span>W: {cab.width}mm</span>
                        <span>•</span>
                        <span>H: {cab.height}mm</span>
                        <span>•</span>
                        <span>D: {cab.depth}mm</span>
                      </div>

                      {/* Mini Progress Bar */}
                      <div className="w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            isReady ? "bg-emerald-500" : "bg-amber-500"
                          }`}
                          style={{
                            width: `${cTotal > 0 ? (cScanned / cTotal) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Middle Column: 3D Cabinet Viewer & Barcode Station (5 cols on xl) */}
          <div className="xl:col-span-5 flex flex-col gap-4">
            {selectedCabinet ? (
              <>
                {/* 3D Visualizer */}
                <div className="relative">
                  <Cabinet3DViewer
                    cabinet={selectedCabinet}
                    selectedPartId={selectedPart?.id}
                    onSelectPart={(p) => {
                      setSelectedPart(p);
                      setActiveRightTab("parts");
                    }}
                  />
                </div>

                {/* Barcode & Manual CIX Scanner Station */}
                <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-xl">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                      <Barcode className="w-4 h-4 text-amber-500" />
                      Scan Physical Part Barcode / Enter CIX Number
                    </label>
                    <span className="text-[11px] text-slate-500">Auto-validates on Enter</span>
                  </div>

                  <form onSubmit={handleScanSubmit} className="flex gap-2">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                      <input
                        ref={scanInputRef}
                        type="text"
                        placeholder="Scan barcode (e.g. KB600_LS) or type CIX..."
                        value={scanInput}
                        onChange={(e) => setScanInput(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700/80 focus:border-amber-500 rounded-xl pl-9 pr-3 py-2.5 text-sm font-mono text-white placeholder-slate-500 outline-none transition"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={scanning || !scanInput.trim()}
                      className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold px-4 py-2.5 rounded-xl text-sm transition flex items-center gap-1.5 shrink-0"
                    >
                      {scanning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Verify Part
                    </button>
                  </form>

                  {/* Scan Status Feedback */}
                  {scanFeedback && (
                    <div
                      className={`mt-2.5 p-3 rounded-xl text-xs flex items-center gap-2 transition ${
                        scanFeedback.type === "success"
                          ? "bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
                          : "bg-rose-500/10 border border-rose-500/30 text-rose-300"
                      }`}
                    >
                      {scanFeedback.type === "success" ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                      )}
                      <span>{scanFeedback.message}</span>
                    </div>
                  )}

                  {/* Cabinet Assembly Milestone & ERP Order Link Banner */}
                  {isCabinetReady && (
                    <div className="mt-3 p-3.5 bg-gradient-to-r from-emerald-950/70 to-slate-900 border border-emerald-500/50 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold">
                          ✓
                        </div>
                        <div>
                          <div className="text-xs font-black uppercase tracking-wider text-emerald-400">
                            Assembly Station Milestone
                          </div>
                          <div className="text-sm font-bold text-white">
                            Cabinet Ready for Full Assembly!
                          </div>
                        </div>
                      </div>

                      {/* Link to ERP Production Order */}
                      <div className="flex items-center gap-2 w-full sm:w-auto">
                        <select
                          value={selectedCabinet.linkedOrderId || selectedOrderId}
                          onChange={(e) => {
                            setSelectedOrderId(e.target.value);
                            if (e.target.value) handleSyncToOrder(Number(e.target.value));
                          }}
                          className="bg-slate-950 border border-emerald-600/60 text-xs font-semibold text-emerald-300 rounded-lg px-2.5 py-1.5 outline-none"
                        >
                          <option value="">Link to Production Order...</option>
                          {erpOrders.map((o) => (
                            <option key={o.id} value={o.id}>
                              Order #{o.orderNumber} {o.title ? `(${o.title})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="h-96 flex items-center justify-center text-slate-500">
                Select a cabinet from the left to view parts and 3D simulation
              </div>
            )}
          </div>

          {/* Right Column: Parts Breakdown & Hardware Kit (4 cols on xl) */}
          <div className="xl:col-span-4 flex flex-col gap-3">
            {selectedCabinet && (
              <>
                {/* Tab Switcher: Parts vs Hardware Checklist */}
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setActiveRightTab("parts")}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                        activeRightTab === "parts"
                          ? "bg-amber-500 text-slate-950"
                          : "text-slate-400 hover:text-white hover:bg-slate-800"
                      }`}
                    >
                      <Cpu className="w-3.5 h-3.5" />
                      Parts ({scannedParts}/{totalParts})
                    </button>
                    <button
                      onClick={() => setActiveRightTab("hardware")}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition ${
                        activeRightTab === "hardware"
                          ? "bg-amber-500 text-slate-950"
                          : "text-slate-400 hover:text-white hover:bg-slate-800"
                      }`}
                    >
                      <Wrench className="w-3.5 h-3.5" />
                      Hardware Kit ({selectedCabinet.hardware?.length || 0})
                    </button>
                  </div>

                  <span className="text-xs font-mono font-bold text-amber-400">
                    {progressPercent}% Complete
                  </span>
                </div>

                {/* Tab 1: Parts List */}
                {activeRightTab === "parts" && (
                  <div className="flex flex-col gap-2 overflow-y-auto max-h-[360px] pr-1">
                    {selectedCabinet.parts.map((part) => {
                      const isSelected = selectedPart?.id === part.id;
                      const hasCix = !!part.cixData;

                      return (
                        <div
                          key={part.id}
                          onClick={() => setSelectedPart(part)}
                          className={`p-3 rounded-2xl border transition cursor-pointer flex items-center justify-between gap-3 ${
                            isSelected
                              ? "bg-slate-800/90 border-amber-500"
                              : part.isScanned
                              ? "bg-emerald-950/20 border-emerald-900/60 hover:bg-slate-800/50"
                              : "bg-slate-900/60 border-slate-800 hover:bg-slate-800/50"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleTogglePart(part.id);
                              }}
                              className={`w-6 h-6 rounded-lg flex items-center justify-center border transition shrink-0 ${
                                part.isScanned
                                  ? "bg-emerald-500 border-emerald-400 text-slate-950 font-bold"
                                  : "bg-slate-800 border-slate-700 text-transparent hover:border-amber-400"
                              }`}
                              title={part.isScanned ? "Mark as unscanned" : "Mark as scanned"}
                            >
                              ✓
                            </button>

                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white text-xs">
                                  {part.name}
                                </span>
                                {hasCix && (
                                  <span className="text-[10px] bg-sky-500/20 text-sky-300 border border-sky-500/30 px-1.5 py-0.2 rounded font-mono">
                                    CIX
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                                {part.length} × {part.width} × {part.thickness} mm • {part.material}
                              </div>
                              <div className="text-[10px] text-amber-400/90 font-mono mt-0.5 flex items-center gap-1.5">
                                <Barcode className="w-3 h-3" />
                                <span>{part.barcode}</span>
                              </div>
                            </div>
                          </div>

                          <div className="flex flex-col items-end">
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                part.isScanned
                                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                                  : "bg-slate-800 text-slate-400 border border-slate-700"
                              }`}
                            >
                              {part.isScanned ? "Available" : "Pending"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Tab 2: Hardware & Fittings Checklist */}
                {activeRightTab === "hardware" && (
                  <div className="flex flex-col gap-2 overflow-y-auto max-h-[360px] pr-1">
                    {selectedCabinet.hardware && selectedCabinet.hardware.length > 0 ? (
                      selectedCabinet.hardware.map((hw) => (
                        <div
                          key={hw.id}
                          className="p-3 bg-slate-900/60 border border-slate-800 rounded-2xl flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-3">
                            <div className="p-2 rounded-xl bg-slate-800 text-amber-400 border border-slate-700">
                              <Wrench className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="text-xs font-bold text-white">{hw.name}</div>
                              <div className="text-[11px] text-slate-400 font-mono mt-0.5">
                                SKU: {hw.sku} • Category: {hw.category}
                              </div>
                            </div>
                          </div>
                          <div className="text-right">
                            <span className="text-sm font-black font-mono text-amber-400 bg-slate-950 px-2.5 py-1 rounded-lg border border-slate-800">
                              × {hw.quantity} pcs
                            </span>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-6 text-center text-slate-500 text-xs">
                        No specific hardware configured for this cabinet.
                      </div>
                    )}
                  </div>
                )}

                {/* Selected Part Detail Card & Rover A Tooling */}
                {selectedPart && activeRightTab === "parts" && (
                  <div className="mt-2 bg-slate-900/90 border border-slate-800 rounded-2xl p-4">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                      <div className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                        <FileCode className="w-4 h-4 text-sky-400" />
                        Selected Part CNC Specifications
                      </div>
                      <span className="text-[11px] font-mono text-amber-400">
                        {selectedPart.barcode}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                      <div className="bg-slate-950 p-2 rounded-xl border border-slate-800/80">
                        <div className="text-[10px] text-slate-500 uppercase">Dimensions</div>
                        <div className="font-mono text-white font-bold">
                          {selectedPart.length} × {selectedPart.width} × {selectedPart.thickness} mm
                        </div>
                      </div>
                      <div className="bg-slate-950 p-2 rounded-xl border border-slate-800/80">
                        <div className="text-[10px] text-slate-500 uppercase">Material</div>
                        <div className="font-mono text-white font-bold truncate">
                          {selectedPart.material}
                        </div>
                      </div>
                      <div className="bg-slate-950 p-2 rounded-xl border border-slate-800/80">
                        <div className="text-[10px] text-slate-500 uppercase">CIX Machine File</div>
                        <div className="font-mono text-sky-400 font-bold truncate">
                          {selectedPart.cixFilename || "Not attached"}
                        </div>
                      </div>
                      <div className="bg-slate-950 p-2 rounded-xl border border-slate-800/80">
                        <div className="text-[10px] text-slate-500 uppercase">Rover A Borings</div>
                        <div className="font-mono text-emerald-400 font-bold">
                          {selectedPart.cixData?.borings.length || 0} Drills
                        </div>
                      </div>
                    </div>

                    {/* Rover A Boring List Preview */}
                    {selectedPart.cixData && selectedPart.cixData.borings.length > 0 && (
                      <div className="mt-3">
                        <div className="text-[11px] font-bold text-slate-400 mb-1.5">
                          Biesse Rover A Boring Operations (Face 0 & Edges):
                        </div>
                        <div className="max-h-28 overflow-y-auto flex flex-col gap-1 pr-1 font-mono text-[11px]">
                          {selectedPart.cixData.borings.map((b, idx) => (
                            <div
                              key={idx}
                              className="bg-slate-950/80 px-2.5 py-1 rounded-lg border border-slate-800/60 flex items-center justify-between text-slate-300"
                            >
                              <span>
                                Hole #{idx + 1} (Face {b.side}): X={b.x} Y={b.y}
                              </span>
                              <span className="text-emerald-400">
                                Ø{b.diameter}mm × {b.depth}mm
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Polyboard Import Modal */}
      {showImportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4">
          <div className="bg-slate-900 border border-slate-800 w-full max-w-2xl rounded-3xl p-6 shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-5">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  <UploadCloud className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white">
                    Import Polyboard Project & CNC Files
                  </h3>
                  <p className="text-xs text-slate-400">
                    Upload .csv cutlist, .pb-proj file, and Biesse Rover A .cix machine programs
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-slate-400 hover:text-white font-bold text-xl px-2"
              >
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-4 text-xs">
              <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-between">
                <div>
                  <div className="font-bold text-amber-300">Quick Test Polyboard Sample</div>
                  <div className="text-[11px] text-amber-400/80">
                    Load pre-configured sample files (Kitchen Villa 42 with CIX & CSV)
                  </div>
                </div>
                <button
                  type="button"
                  onClick={loadDemoFilesInModal}
                  className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-3 py-1.5 rounded-xl text-xs transition"
                >
                  Load Sample Files
                </button>
              </div>

              <div>
                <label className="font-bold text-slate-300 block mb-1">Project Name</label>
                <input
                  type="text"
                  placeholder="e.g. Modern Kitchen Cabinets Villa 42"
                  value={importProjName}
                  onChange={(e) => setImportProjName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl px-3 py-2 text-white outline-none"
                />
              </div>

              <div className="border border-slate-800 bg-slate-950/60 p-3.5 rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold text-slate-300 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-amber-400" />
                    Polyboard Cutting List (.csv)
                  </div>
                  {csvFile && (
                    <span className="text-emerald-400 text-[11px] font-mono">
                      ✓ {csvFile.name}
                    </span>
                  )}
                </div>
                <input
                  type="file"
                  accept=".csv,.txt"
                  onChange={(e) => handleFileUpload(e, "csv")}
                  className="text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700"
                />
              </div>

              <div className="border border-slate-800 bg-slate-950/60 p-3.5 rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold text-slate-300 flex items-center gap-1.5">
                    <FolderOpen className="w-4 h-4 text-sky-400" />
                    Polyboard Project File (.pb-proj / .pb-cab) [Optional]
                  </div>
                  {pbProjFile && (
                    <span className="text-emerald-400 text-[11px] font-mono">
                      ✓ {pbProjFile.name}
                    </span>
                  )}
                </div>
                <input
                  type="file"
                  accept=".pb-proj,.pb-cab,.txt"
                  onChange={(e) => handleFileUpload(e, "pbproj")}
                  className="text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700"
                />
              </div>

              <div className="border border-slate-800 bg-slate-950/60 p-3.5 rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold text-slate-300 flex items-center gap-1.5">
                    <Cpu className="w-4 h-4 text-emerald-400" />
                    Biesse Rover A Machine Files (*.cix)
                  </div>
                  <span className="text-slate-400 text-[11px] font-mono">
                    {cixFilesList.length} files selected
                  </span>
                </div>
                <input
                  type="file"
                  multiple
                  accept=".cix,.cid,.txt"
                  onChange={(e) => handleFileUpload(e, "cix")}
                  className="text-slate-400 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-slate-800 file:text-slate-200 hover:file:bg-slate-700"
                />
                {cixFilesList.length > 0 && (
                  <div className="mt-2 max-h-24 overflow-y-auto flex flex-wrap gap-1">
                    {cixFilesList.map((c, i) => (
                      <span
                        key={i}
                        className="bg-slate-900 border border-slate-700 px-2 py-0.5 rounded text-[10px] text-slate-300 font-mono"
                      >
                        {c.filename}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="font-bold text-slate-300 block mb-1">Notes / Job Reference</label>
                <textarea
                  rows={2}
                  placeholder="Optional notes or instructions for assembly team..."
                  value={importNotes}
                  onChange={(e) => setImportNotes(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-amber-500 rounded-xl px-3 py-2 text-white outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 rounded-xl text-slate-400 hover:bg-slate-800 font-medium text-xs transition"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={importing || (!csvFile && !pbProjFile)}
                onClick={handleExecuteImport}
                className="bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold px-5 py-2 rounded-xl text-xs shadow-lg transition"
              >
                {importing ? "Importing & Parsing..." : "Start Import"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
