"use client";

import React, { useState, useEffect } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { 
  FileText, 
  Download, 
  Printer, 
  Save, 
  Calendar, 
  BarChart3, 
  Users, 
  Package, 
  Cpu, 
  ClipboardList,
  Trash2,
  Eye,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  X,
  TrendingUp,
  DollarSign,
  Timer,
  Zap,
  FileSpreadsheet,
  RefreshCcw,
  Clock
} from "lucide-react";

interface ReportViewProps {
  currentUser: any;
  searchQuery?: string;
}

const reportTypes = [
  { id: "Production Summary", label: "Production Summary", icon: BarChart3 },
  { id: "Machine Utilization", label: "Machine Utilization", icon: Cpu },
  { id: "Order Status", label: "Order Status Report", icon: ClipboardList },
  { id: "Inventory Status", label: "Inventory Status", icon: Package },
  { id: "Client Activity", label: "Client Activity", icon: Users },
  { id: "Operator Performance", label: "Operator Performance", icon: TrendingUp },
  { id: "Downtime Analysis", label: "Downtime Analysis", icon: Timer },
  { id: "Scrap & Rework Analysis", label: "Scrap & Rework Analysis", icon: RefreshCcw },
];

export default function ReportView({ currentUser, searchQuery = "" }: ReportViewProps) {
  const [selectedType, setSelectedType] = useState("Production Summary");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split("T")[0]);
  const [reportName, setReportName] = useState("");
  const [generatedReport, setGeneratedReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedReports, setSavedReports] = useState<any[]>([]);
  const [showSavedReports, setShowSavedReports] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const fetchSavedReports = async () => {
    try {
      const res = await fetch("/api/reports");
      if (res.ok) {
        const data = await res.json();
        setSavedReports(data);
      }
    } catch (err) {
      console.error("Failed to fetch saved reports", err);
    }
  };

  useEffect(() => {
    fetchSavedReports();
  }, []);

  const generateReport = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: reportName || `${selectedType} - ${new Date().toLocaleDateString()}`,
          type: selectedType,
          dateFrom: new Date(dateFrom),
          dateTo: new Date(dateTo),
          generatedBy: currentUser?.id,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to generate report");
      setGeneratedReport(data);
      setNotice("Report generated successfully!");
      setTimeout(() => setNotice(""), 3000);
      fetchSavedReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate report");
    } finally {
      setLoading(false);
    }
  };

  const saveReport = async () => {
    if (!generatedReport) return;
    setSaving(true);
    setError("");
    try {
      // Report is already saved on generation, just confirm
      setNotice("Report saved to database!");
      setTimeout(() => setNotice(""), 3000);
      fetchSavedReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save report");
    } finally {
      setSaving(false);
    }
  };

  const deleteSavedReport = async (reportId: number) => {
    if (!confirm("Delete this saved report?")) return;
    try {
      const res = await fetch(`/api/reports?reportId=${reportId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      fetchSavedReports();
      setNotice("Report deleted");
      setTimeout(() => setNotice(""), 3000);
    } catch (err) {
      setError("Failed to delete report");
    }
  };

  const loadSavedReport = async (report: any) => {
    setGeneratedReport({ ...report, data: report.dataJson });
    setSelectedType(report.type);
    setShowSavedReports(false);
    setNotice("Report loaded from archive");
    setTimeout(() => setNotice(""), 3000);
  };

  const printReport = () => {
    window.print();
  };

  const exportPDF = () => {
    if (!generatedReport) return;
    
    const doc = new jsPDF();
    const data = generatedReport.data;
    const reportType = generatedReport.type;

    // Header
    doc.setFontSize(18);
    doc.setTextColor(40);
    doc.text("WoodTek ERP - System Report", 14, 20);
    
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Report: ${generatedReport.name}`, 14, 30);
    doc.text(`Type: ${reportType}`, 14, 36);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 14, 42);
    doc.text(`Period: ${new Date(generatedReport.dateFrom).toLocaleDateString()} - ${new Date(generatedReport.dateTo).toLocaleDateString()}`, 14, 48);

    let startY = 58;

    if (reportType === "Production Summary") {
      doc.setFontSize(14);
      doc.text("Production Overview", 14, startY);
      startY += 10;
      
      autoTable(doc, {
        startY,
        head: [["Metric", "Value"]],
        body: [
          ["Total Orders", String(data.totalOrders)],
          ["Completed", String(data.completedOrders)],
          ["In Production", String(data.inProductionOrders)],
          ["Pending", String(data.pendingOrders)],
          ["Total Value", `$${Number(data.totalValue).toLocaleString()}`],
        ],
        theme: "grid",
        headStyles: { fillColor: [245, 158, 11] },
      });
    } else if (reportType === "Machine Utilization") {
      doc.setFontSize(14);
      doc.text("Machine Utilization Summary", 14, startY);
      startY += 10;

      autoTable(doc, {
        startY,
        head: [["Machine", "Category", "Operations", "Hours", "Status"]],
        body: data.machines.map((m: any) => [
          m.machineCode,
          m.category,
          String(m.completedOperations),
          String(m.totalHours),
          m.status,
        ]),
        theme: "grid",
        headStyles: { fillColor: [245, 158, 11] },
      });
    } else if (reportType === "Order Status") {
      doc.setFontSize(14);
      doc.text("Order Status Overview", 14, startY);
      startY += 10;

      autoTable(doc, {
        startY,
        head: [["Order #", "Title", "Status", "Progress", "Value"]],
        body: data.orders.slice(0, 20).map((o: any) => [
          o.orderNumber,
          o.title.substring(0, 30),
          o.status,
          `${o.progressPercent}%`,
          `$${Number(o.totalValue).toLocaleString()}`,
        ]),
        theme: "grid",
        headStyles: { fillColor: [245, 158, 11] },
      });
    } else if (reportType === "Inventory Status") {
      doc.setFontSize(14);
      doc.text("Inventory Status", 14, startY);
      startY += 10;

      autoTable(doc, {
        startY,
        head: [["SKU", "Item", "Stock", "Unit", "Value", "Status"]],
        body: data.items.map((i: any) => [
          i.sku,
          i.name.substring(0, 25),
          String(i.stockQuantity),
          i.unit,
          `$${Number(i.totalValue).toLocaleString()}`,
          i.isLowStock ? "LOW" : "OK",
        ]),
        theme: "grid",
        headStyles: { fillColor: [245, 158, 11] },
        didParseCell: (hookData) => {
          if (hookData.cell.raw === "LOW") {
            hookData.cell.styles.textColor = [220, 38, 38];
          }
        },
      });
    } else if (reportType === "Client Activity") {
      doc.setFontSize(14);
      doc.text("Client Activity Summary", 14, startY);
      startY += 10;

      autoTable(doc, {
        startY,
        head: [["Client", "Contact", "Orders", "Active", "Total Spend"]],
        body: data.clients.map((c: any) => [
          c.company,
          c.contactName,
          String(c.totalOrders),
          String(c.activeOrders),
          `$${Number(c.totalSpend).toLocaleString()}`,
        ]),
        theme: "grid",
        headStyles: { fillColor: [245, 158, 11] },
      });
    } else if (reportType === "Operator Performance") {
      doc.setFontSize(14);
      doc.text("Operator Performance", 14, startY);
      startY += 10;

      autoTable(doc, {
        startY,
        head: [["Operator", "Completed Ops", "Total Hours", "Efficiency"]],
        body: data.operators.map((o: any) => [
          o.name,
          String(o.completedOperations),
          String(o.totalHours),
          `${o.avgEfficiency}%`,
        ]),
        theme: "grid",
        headStyles: { fillColor: [245, 158, 11] },
      });
    } else if (reportType === "Downtime Analysis") {
      doc.setFontSize(14);
      doc.text("Downtime Analysis", 14, startY);
      startY += 10;

      autoTable(doc, {
        startY,
        head: [["Metric", "Value"]],
        body: [
          ["Total Stoppages", String(data.kpis.totalStoppages)],
          ["Total Downtime (hrs)", String(data.kpis.totalHours)],
          ["Average Duration (min)", String(data.kpis.avgMinutes)],
          ["Open Right Now", String(data.kpis.openStoppages)],
        ],
        theme: "grid",
        headStyles: { fillColor: [245, 158, 11] },
      });

      const after = (doc as any).lastAutoTable?.finalY ?? startY;
      doc.setFontSize(14);
      doc.text("By Reason (Pareto)", 14, after + 14);
      autoTable(doc, {
        startY: after + 18,
        head: [["Reason", "Stoppages", "Minutes"]],
        body: data.byReason.map((r: any) => [r.reason, String(r.count), String(r.minutes)]),
        theme: "grid",
        headStyles: { fillColor: [245, 158, 11] },
      });

      const after2 = (doc as any).lastAutoTable?.finalY ?? after + 18;
      doc.setFontSize(14);
      doc.text("By Machine", 14, after2 + 14);
      autoTable(doc, {
        startY: after2 + 18,
        head: [["Machine", "Stoppages", "Hours", "Avg (min)"]],
        body: data.machines.map((m: any) => [m.machineCode, String(m.stoppages), String(m.hours), String(m.avgMinutes)]),
        theme: "grid",
        headStyles: { fillColor: [245, 158, 11] },
      });
    } else if (reportType === "Scrap & Rework Analysis") {
      doc.setFontSize(14);
      doc.text("Scrap & Rework Analysis", 14, startY);
      startY += 10;

      autoTable(doc, {
        startY,
        head: [["Metric", "Value"]],
        body: [
          ["Scrap Quantity", String(data.kpis.scrapQty)],
          ["Scrap Cost ($)", `$${Number(data.kpis.scrapCost).toLocaleString()}`],
          ["Rework Quantity", String(data.kpis.reworkQty)],
          ["Rework Cost ($)", `$${Number(data.kpis.reworkCost).toLocaleString()}`],
          ["Open Rework", String(data.kpis.openRework)],
          ["Rework Passed", String(data.kpis.reworkPassed)],
        ],
        theme: "grid",
        headStyles: { fillColor: [245, 158, 11] },
      });

      const after = (doc as any).lastAutoTable?.finalY ?? startY;
      doc.setFontSize(14);
      doc.text("Scrap by Reason", 14, after + 14);
      autoTable(doc, {
        startY: after + 18,
        head: [["Reason", "Qty", "Est. Cost"]],
        body: data.scrapByReason.map((r: any) => [r.reason, String(r.qty), `$${Number(r.cost).toLocaleString()}`]),
        theme: "grid",
        headStyles: { fillColor: [245, 158, 11] },
      });

      const after2 = (doc as any).lastAutoTable?.finalY ?? after + 18;
      doc.setFontSize(14);
      doc.text("Rework by Reason", 14, after2 + 14);
      autoTable(doc, {
        startY: after2 + 18,
        head: [["Reason", "Qty", "Est. Cost"]],
        body: data.reworkByReason.map((r: any) => [r.reason, String(r.qty), `$${Number(r.cost).toLocaleString()}`]),
        theme: "grid",
        headStyles: { fillColor: [245, 158, 11] },
      });
    }

    doc.save(`${generatedReport.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.pdf`);
  };

  const exportCSV = () => {
    if (!generatedReport) return;
    const data = generatedReport.data;
    const reportType = generatedReport.type;

    const esc = (v: any) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const toCSV = (headers: string[], rows: (string | number)[][]) =>
      [headers.map(esc).join(","), ...rows.map(r => r.map(esc).join(","))].join("\r\n");

    let csv = "";

    if (reportType === "Production Summary") {
      csv = toCSV(
        ["Metric", "Value"],
        [["Total Orders", data.totalOrders], ["Completed", data.completedOrders], ["In Production", data.inProductionOrders], ["Pending", data.pendingOrders], ["Total Value", data.totalValue]],
      );
    } else if (reportType === "Machine Utilization") {
      csv = toCSV(
        ["Machine", "Category", "Operations", "Hours", "Status"],
        data.machines.map((m: any) => [m.machineCode, m.category, m.completedOperations, m.totalHours, m.status]),
      );
    } else if (reportType === "Order Status") {
      csv = toCSV(
        ["Order #", "Title", "Status", "Progress", "Value"],
        data.orders.map((o: any) => [o.orderNumber, o.title, o.status, `${o.progressPercent}%`, o.totalValue]),
      );
    } else if (reportType === "Inventory Status") {
      csv = toCSV(
        ["SKU", "Item", "Stock", "Unit", "Value", "Status"],
        data.items.map((i: any) => [i.sku, i.name, i.stockQuantity, i.unit, i.totalValue, i.isLowStock ? "LOW" : "OK"]),
      );
    } else if (reportType === "Client Activity") {
      csv = toCSV(
        ["Client", "Contact", "Orders", "Active", "Total Spend"],
        data.clients.map((c: any) => [c.company, c.contactName, c.totalOrders, c.activeOrders, c.totalSpend]),
      );
    } else if (reportType === "Operator Performance") {
      csv = toCSV(
        ["Operator", "Completed Ops", "Total Hours", "Efficiency"],
        data.operators.map((o: any) => [o.name, o.completedOperations, o.totalHours, `${o.avgEfficiency}%`]),
      );
    } else if (reportType === "Downtime Analysis") {
      csv = toCSV(
        ["Reason", "Stoppages", "Minutes"],
        data.byReason.map((r: any) => [r.reason, r.count, r.minutes]),
      );
    } else if (reportType === "Scrap & Rework Analysis") {
      csv = toCSV(
        ["Category", "Reason", "Qty", "Est. Cost"],
        [
          ...data.scrapByReason.map((r: any) => ["Scrap", r.reason, r.qty, r.cost]),
          ...data.reworkByReason.map((r: any) => ["Rework", r.reason, r.qty, r.cost]),
        ],
      );
    }

    if (!csv) return;
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${generatedReport.name.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto print:p-0">
      {/* Report Generator Header - Hidden when printing */}
      <div className="print:hidden bg-slate-900/90 border border-slate-800/80 rounded-2xl p-6 shadow-sm space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <FileText className="w-6 h-6 text-amber-400" />
            <span>System Report Generator</span>
          </h1>
          <p className="text-sm text-slate-400 mt-1">Generate, preview, save, and export production reports.</p>
        </div>

        {(error || notice) && (
          <div className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-xs font-bold ${error ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`}>
            <span>{error || notice}</span>
            <button onClick={() => { setError(""); setNotice(""); }} className="hover:opacity-70"><X className="w-4 h-4" /></button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Report Type */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-2">Report Type</label>
            <select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
            >
              {reportTypes.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </div>

          {/* Date From */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-2">From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Date To */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-2">To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
            />
          </div>

          {/* Report Name */}
          <div>
            <label className="block text-xs font-bold text-slate-300 mb-2">Report Name</label>
            <input
              type="text"
              placeholder="e.g. Monthly Production Summary"
              value={reportName}
              onChange={(e) => setReportName(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-amber-500"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <button
            onClick={generateReport}
            disabled={loading}
            className="flex items-center gap-2 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-slate-950 font-black px-5 py-2.5 rounded-xl text-xs shadow-lg shadow-amber-600/30 transition disabled:opacity-50"
          >
            <BarChart3 className="w-4 h-4" />
            <span>{loading ? "Generating..." : "Generate Report"}</span>
          </button>

          {generatedReport && (
            <>
              <button
                onClick={exportPDF}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs border border-slate-700 transition"
              >
                <Download className="w-4 h-4" />
                <span>Export PDF</span>
              </button>

              <button
                onClick={exportCSV}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs border border-slate-700 transition"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span>Export CSV</span>
              </button>

              <button
                onClick={printReport}
                className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-white font-bold px-4 py-2.5 rounded-xl text-xs border border-slate-700 transition"
              >
                <Printer className="w-4 h-4" />
                <span>Print</span>
              </button>

              <button
                onClick={saveReport}
                disabled={saving}
                className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold px-4 py-2.5 rounded-xl text-xs transition disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? "Saving..." : "Save Report"}</span>
              </button>
            </>
          )}

          <button
            onClick={() => setShowSavedReports(!showSavedReports)}
            className="flex items-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold px-4 py-2.5 rounded-xl text-xs border border-slate-700 transition"
          >
            <Eye className="w-4 h-4" />
            <span>Saved Reports ({savedReports.length})</span>
          </button>
        </div>

        {/* Saved Reports Panel */}
        {showSavedReports && (
          <div className="border-t border-slate-800 pt-4">
            <h3 className="text-sm font-bold text-white mb-3">Archived Reports</h3>
            {savedReports.length === 0 ? (
              <p className="text-xs text-slate-500">No saved reports yet.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {savedReports.map((report) => (
                  <div key={report.id} className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-white truncate">{report.name}</div>
                      <div className="text-[10px] text-slate-400">{report.type} · {new Date(report.createdAt).toLocaleDateString()}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => loadSavedReport(report)} className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-white" title="Load">
                        <Eye className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => deleteSavedReport(report.id)} className="p-1.5 hover:bg-rose-500/20 rounded-lg text-slate-400 hover:text-rose-400" title="Delete">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Report Preview */}
      {generatedReport && (
        <div className="bg-white text-slate-900 rounded-2xl p-8 shadow-xl print:shadow-none print:rounded-none">
          {/* Report Header */}
          <div className="border-b-2 border-amber-500 pb-6 mb-6 print:border-slate-300">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-black text-slate-900">{generatedReport.name}</h2>
                <p className="text-sm text-slate-600 mt-1">{generatedReport.type}</p>
              </div>
              <div className="text-right">
                <div className="text-xs text-slate-500">Generated</div>
                <div className="text-sm font-bold text-slate-900">{new Date().toLocaleString()}</div>
                <div className="text-xs text-slate-500 mt-1">By: {currentUser?.name || "System"}</div>
              </div>
            </div>
            <div className="mt-4 text-xs text-slate-600">
              Period: <span className="font-bold">{new Date(generatedReport.dateFrom).toLocaleDateString()}</span> to <span className="font-bold">{new Date(generatedReport.dateTo).toLocaleDateString()}</span>
            </div>
          </div>

          {/* Report Content */}
          <ReportContent data={generatedReport.data} type={generatedReport.type} />
        </div>
      )}

      {!generatedReport && (
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-16 text-center">
          <FileText className="w-20 h-20 text-slate-600 mx-auto mb-4 stroke-[1.5]" />
          <h3 className="text-lg font-bold text-white mb-1">No Report Generated</h3>
          <p className="text-sm text-slate-400">Select a report type and date range above, then click Generate Report.</p>
        </div>
      )}
    </div>
  );
}

function ReportContent({ data, type }: { data: any; type: string }) {
  if (type === "Production Summary") {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <StatCard label="Total Orders" value={String(data.totalOrders)} icon={ClipboardList} />
          <StatCard label="Completed" value={String(data.completedOrders)} color="text-emerald-600" icon={CheckCircle2} />
          <StatCard label="In Production" value={String(data.inProductionOrders)} color="text-amber-600" icon={Cpu} />
          <StatCard label="Pending" value={String(data.pendingOrders)} color="text-slate-600" icon={AlertTriangle} />
          <StatCard label="Total Value" value={`$${Number(data.totalValue).toLocaleString()}`} color="text-blue-600" icon={DollarSign} />
        </div>

        <div>
          <h3 className="text-lg font-bold text-slate-900 mb-4">Order Details</h3>
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b-2 border-slate-200 text-xs font-bold text-slate-600 uppercase">
                <th className="py-2 px-3">Order #</th>
                <th className="py-2 px-3">Title</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3 text-right">Value</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {data.orders.map((order: any, idx: number) => (
                <tr key={idx} className="border-b border-slate-100">
                  <td className="py-2 px-3 font-mono text-xs font-bold">{order.orderNumber}</td>
                  <td className="py-2 px-3">{order.title}</td>
                  <td className="py-2 px-3"><span className="text-xs font-bold px-2 py-1 rounded bg-slate-100">{order.status}</span></td>
                  <td className="py-2 px-3 text-right font-mono font-bold">${Number(order.totalValue).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (type === "Machine Utilization") {
    return (
      <div>
        <h3 className="text-lg font-bold text-slate-900 mb-4">Machine Performance</h3>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-200 text-xs font-bold text-slate-600 uppercase">
              <th className="py-2 px-3">Machine</th>
              <th className="py-2 px-3">Category</th>
              <th className="py-2 px-3 text-center">Completed Ops</th>
              <th className="py-2 px-3 text-right">Total Hours</th>
              <th className="py-2 px-3">Status</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {data.machines.map((m: any, idx: number) => (
              <tr key={idx} className="border-b border-slate-100">
                <td className="py-2 px-3 font-bold">{m.machineCode} - {m.machineName}</td>
                <td className="py-2 px-3 text-slate-600">{m.category}</td>
                <td className="py-2 px-3 text-center font-mono">{m.completedOperations}</td>
                <td className="py-2 px-3 text-right font-mono font-bold">{m.totalHours}</td>
                <td className="py-2 px-3"><span className={`text-xs font-bold px-2 py-1 rounded ${m.status === "Active" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{m.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (type === "Inventory Status") {
    return (
      <div>
        <div className="grid grid-cols-3 gap-4 mb-6">
          <StatCard label="Total Items" value={String(data.totalItems)} icon={Package} />
          <StatCard label="Low Stock Alerts" value={String(data.lowStockItems)} color="text-rose-600" icon={AlertTriangle} />
          <StatCard label="Total Inventory Value" value={`$${Number(data.totalValue).toLocaleString()}`} color="text-blue-600" icon={DollarSign} />
        </div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-200 text-xs font-bold text-slate-600 uppercase">
              <th className="py-2 px-3">SKU</th>
              <th className="py-2 px-3">Item</th>
              <th className="py-2 px-3 text-center">Stock</th>
              <th className="py-2 px-3 text-right">Unit Cost</th>
              <th className="py-2 px-3 text-right">Total Value</th>
              <th className="py-2 px-3">Status</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {data.items.map((item: any, idx: number) => (
              <tr key={idx} className="border-b border-slate-100">
                <td className="py-2 px-3 font-mono text-xs font-bold">{item.sku}</td>
                <td className="py-2 px-3">{item.name}</td>
                <td className="py-2 px-3 text-center font-mono">{item.stockQuantity} {item.unit}</td>
                <td className="py-2 px-3 text-right font-mono">${Number(item.unitCost).toFixed(2)}</td>
                <td className="py-2 px-3 text-right font-mono font-bold">${Number(item.totalValue).toLocaleString()}</td>
                <td className="py-2 px-3"><span className={`text-xs font-bold px-2 py-1 rounded ${item.isLowStock ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700"}`}>{item.isLowStock ? "LOW STOCK" : "OK"}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (type === "Client Activity") {
    return (
      <div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-200 text-xs font-bold text-slate-600 uppercase">
              <th className="py-2 px-3">Client</th>
              <th className="py-2 px-3">Contact</th>
              <th className="py-2 px-3 text-center">Orders</th>
              <th className="py-2 px-3 text-center">Active</th>
              <th className="py-2 px-3 text-right">Total Spend</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {data.clients.map((c: any, idx: number) => (
              <tr key={idx} className="border-b border-slate-100">
                <td className="py-2 px-3 font-bold">{c.company}</td>
                <td className="py-2 px-3 text-slate-600">{c.contactName}</td>
                <td className="py-2 px-3 text-center font-mono">{c.totalOrders}</td>
                <td className="py-2 px-3 text-center font-mono">{c.activeOrders}</td>
                <td className="py-2 px-3 text-right font-mono font-bold">${Number(c.totalSpend).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (type === "Operator Performance") {
    return (
      <div>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b-2 border-slate-200 text-xs font-bold text-slate-600 uppercase">
              <th className="py-2 px-3">Operator</th>
              <th className="py-2 px-3 text-center">Completed Ops</th>
              <th className="py-2 px-3 text-right">Total Hours</th>
              <th className="py-2 px-3 text-right">Avg Efficiency</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {data.operators.map((o: any, idx: number) => (
              <tr key={idx} className="border-b border-slate-100">
                <td className="py-2 px-3 font-bold">{o.name}</td>
                <td className="py-2 px-3 text-center font-mono">{o.completedOperations}</td>
                <td className="py-2 px-3 text-right font-mono font-bold">{o.totalHours}</td>
                <td className="py-2 px-3 text-right"><span className="text-xs font-bold px-2 py-1 rounded bg-emerald-100 text-emerald-700">{o.avgEfficiency}%</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (type === "Downtime Analysis") {
    const maxReason = Math.max(1, ...data.byReason.map((r: any) => r.minutes));
    const maxDay = Math.max(1, ...data.timeline.map((d: any) => d.minutes));
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Downtime" value={`${data.kpis.totalHours} hrs`} color="text-rose-600" icon={Timer} />
          <StatCard label="Stoppages" value={String(data.kpis.totalStoppages)} icon={Zap} />
          <StatCard label="Avg Duration" value={`${data.kpis.avgMinutes} min`} color="text-amber-600" icon={AlertTriangle} />
          <StatCard label="Open Right Now" value={String(data.kpis.openStoppages)} color={data.kpis.openStoppages > 0 ? "text-rose-600" : "text-emerald-600"} icon={Clock} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-4">Downtime by Reason</h3>
            {data.byReason.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No downtime recorded in this period.</p>
            ) : (
              <div className="space-y-3">
                {data.byReason.map((r: any, i: number) => (
                  <div key={i}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-semibold text-slate-700">{r.reason}</span>
                      <span className="font-mono text-xs font-bold text-slate-600">{r.count}× · {r.minutes}m</span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-rose-500 to-amber-500 rounded-full" style={{ width: `${(r.minutes / maxReason) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-4">Daily Downtime Trend</h3>
            {data.timeline.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No downtime recorded in this period.</p>
            ) : (
              <div className="flex items-end gap-1.5 h-40">
                {data.timeline.map((d: any, i: number) => (
                  <div key={i} className="flex-1 flex flex-col items-center justify-end h-full group">
                    <div className="text-[9px] font-bold text-slate-500 mb-1">{d.minutes > 0 ? `${d.minutes}` : ""}</div>
                    <div
                      className="w-full rounded-t-md bg-gradient-to-t from-rose-500 to-amber-400"
                      style={{ height: `${(d.minutes / maxDay) * 100}%`, minHeight: d.minutes > 0 ? 4 : 2 }}
                      title={`${d.date}: ${d.minutes}m`}
                    />
                    <div className="text-[8px] text-slate-400 mt-1 -rotate-45 origin-top-left whitespace-nowrap">{d.date.slice(5)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {data.machines.length > 0 && (
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-4">By Machine</h3>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-200 text-xs font-bold text-slate-600 uppercase">
                  <th className="py-2 px-3">Machine</th>
                  <th className="py-2 px-3">Category</th>
                  <th className="py-2 px-3 text-center">Stoppages</th>
                  <th className="py-2 px-3 text-right">Total Hours</th>
                  <th className="py-2 px-3 text-right">Avg (min)</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {data.machines.map((m: any, idx: number) => (
                  <tr key={idx} className="border-b border-slate-100">
                    <td className="py-2 px-3 font-bold">{m.machineCode} - {m.machineName}</td>
                    <td className="py-2 px-3 text-slate-600">{m.category}</td>
                    <td className="py-2 px-3 text-center font-mono">{m.stoppages}</td>
                    <td className="py-2 px-3 text-right font-mono font-bold">{m.hours}</td>
                    <td className="py-2 px-3 text-right font-mono">{m.avgMinutes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (type === "Scrap & Rework Analysis") {
    const maxScrap = Math.max(1, ...data.scrapByReason.map((r: any) => r.qty));
    const maxRework = Math.max(1, ...data.reworkByReason.map((r: any) => r.qty));
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Scrap Qty" value={`${data.kpis.scrapQty} pcs`} color="text-rose-600" icon={Trash2} />
          <StatCard label="Scrap Cost" value={`$${Number(data.kpis.scrapCost).toLocaleString()}`} color="text-rose-600" icon={DollarSign} />
          <StatCard label="Rework Qty" value={`${data.kpis.reworkQty} pcs`} color="text-amber-600" icon={RefreshCcw} />
          <StatCard label="Open Rework" value={String(data.kpis.openRework)} color={data.kpis.openRework > 0 ? "text-amber-600" : "text-emerald-600"} icon={AlertTriangle} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-4">Scrap by Reason</h3>
            {data.scrapByReason.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No scrap recorded in this period.</p>
            ) : (
              <div className="space-y-3">
                {data.scrapByReason.map((r: any, i: number) => (
                  <div key={i}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-semibold text-slate-700">{r.reason}</span>
                      <span className="font-mono text-xs font-bold text-slate-600">{r.qty} pcs · ${Number(r.cost).toLocaleString()}</span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-rose-500 rounded-full" style={{ width: `${(r.qty / maxScrap) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-4">Rework by Reason</h3>
            {data.reworkByReason.length === 0 ? (
              <p className="text-sm text-slate-500 italic">No rework recorded in this period.</p>
            ) : (
              <div className="space-y-3">
                {data.reworkByReason.map((r: any, i: number) => (
                  <div key={i}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-semibold text-slate-700">{r.reason}</span>
                      <span className="font-mono text-xs font-bold text-slate-600">{r.qty} pcs · ${Number(r.cost).toLocaleString()}</span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full" style={{ width: `${(r.qty / maxRework) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {data.byMachine.length > 0 && (
          <div>
            <h3 className="text-lg font-bold text-slate-900 mb-4">By Machine</h3>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-200 text-xs font-bold text-slate-600 uppercase">
                  <th className="py-2 px-3">Machine</th>
                  <th className="py-2 px-3 text-center">Scrap</th>
                  <th className="py-2 px-3 text-center">Rework</th>
                  <th className="py-2 px-3 text-center">Events</th>
                  <th className="py-2 px-3 text-right">Est. Cost</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {data.byMachine.map((m: any, idx: number) => (
                  <tr key={idx} className="border-b border-slate-100">
                    <td className="py-2 px-3 font-bold">{m.machineCode}</td>
                    <td className="py-2 px-3 text-center font-mono text-rose-600 font-bold">{m.scrapQty}</td>
                    <td className="py-2 px-3 text-center font-mono text-amber-600 font-bold">{m.reworkQty}</td>
                    <td className="py-2 px-3 text-center font-mono">{m.events}</td>
                    <td className="py-2 px-3 text-right font-mono font-bold">${Number(m.cost).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  return <div className="text-slate-500 text-sm">Report type not recognized.</div>;
}

function StatCard({ label, value, color = "text-slate-900", icon: Icon }: { label: string; value: string; color?: string; icon: any }) {
  return (
    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
      <div className="flex items-center gap-2 text-slate-500 mb-1">
        <Icon className="w-4 h-4" />
        <span className="text-xs font-bold uppercase">{label}</span>
      </div>
      <div className={`text-2xl font-black ${color}`}>{value}</div>
    </div>
  );
}
