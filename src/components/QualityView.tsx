"use client";

import React, { useState, useEffect } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Filter,
  Flame,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react";

const REJECT_REASONS = [
  "Tool wear",
  "Material defect",
  "Setup issue",
  "Waiting on parts",
  "Operator error",
  "Other",
];

const DISPOSITIONS = ["All", "Open", "In Rework", "Reworked & Passed", "Scrapped"];

interface QualityViewProps {
  currentUser: any;
  onSelectOrder: (orderId: number) => void;
}

export default function QualityView({ currentUser, onSelectOrder }: QualityViewProps) {
  const [events, setEvents] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("All");
  const [dispFilter, setDispFilter] = useState("All");
  const [showModal, setShowModal] = useState(false);
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);

  // New event form state
  const [orderId, setOrderId] = useState("");
  const [eventType, setEventType] = useState<"scrap" | "rework">("scrap");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("pcs");
  const [reason, setReason] = useState(REJECT_REASONS[0]);
  const [machineId, setMachineId] = useState("");
  const [cost, setCost] = useState("0.00");
  const [notes, setNotes] = useState("");

  const fetchEvents = async () => {
    const params = new URLSearchParams();
    if (typeFilter !== "All") params.set("type", typeFilter);
    if (dispFilter !== "All") params.set("disposition", dispFilter);
    try {
      const res = await fetch(`/api/quality?${params.toString()}`, { cache: "no-store" });
      if (res.ok) setEvents(await res.json());
    } catch (err) {
      console.error("Failed to fetch quality events", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, [typeFilter, dispFilter]);

  useEffect(() => {
    (async () => {
      try {
        const [oRes, mRes] = await Promise.all([fetch("/api/orders"), fetch("/api/machines")]);
        if (oRes.ok) setOrders(await oRes.json());
        if (mRes.ok) setMachines(await mRes.json());
      } catch (err) {
        console.error("Failed to load reference data", err);
      }
    })();
  }, []);

  const handleDisposition = async (id: number, disposition: string) => {
    setBusyId(id);
    setActionError("");
    try {
      const res = await fetch(`/api/quality/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disposition }),
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p.error || "Update failed");
      }
      await fetchEvents();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this quality record?")) return;
    try {
      const res = await fetch(`/api/quality/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p.error || "Delete failed");
      }
      await fetchEvents();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const submitEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionError("");
    if (!orderId) {
      setActionError("Choose an order for this defect.");
      return;
    }
    try {
      const res = await fetch("/api/quality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: Number(orderId),
          eventType,
          quantity: Number(quantity),
          unit,
          reason,
          machineId: machineId ? Number(machineId) : null,
          estimatedCost: cost,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p.error || "Failed to record defect");
      }
      setShowModal(false);
      setOrderId("");
      setQuantity("1");
      setNotes("");
      setCost("0.00");
      await fetchEvents();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to record defect");
    }
  };

  const scrapQty = events.filter(e => e.eventType === "scrap").reduce((s, e) => s + e.quantity, 0);
  const scrapCost = events.filter(e => e.eventType === "scrap").reduce((s, e) => s + (parseFloat(e.estimatedCost || "0") || 0) * e.quantity, 0);
  const openRework = events.filter(e => e.eventType === "rework" && (e.disposition === "Open" || e.disposition === "In Rework"));
  const resolvedRework = events.filter(e => e.eventType === "rework" && e.disposition === "Reworked & Passed");

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Scrapped Qty</div>
          <div className="text-2xl font-black text-rose-400 mt-1">{scrapQty} pcs</div>
        </div>
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Scrap Cost Est.</div>
          <div className="text-2xl font-black text-white mt-1">${scrapCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Open Rework</div>
          <div className={`text-2xl font-black mt-1 ${openRework.length > 0 ? "text-orange-400" : "text-emerald-400"}`}>{openRework.length}</div>
        </div>
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Rework Passed</div>
          <div className="text-2xl font-black text-emerald-400 mt-1">{resolvedRework.length}</div>
        </div>
      </div>

      {actionError && (
        <div className="p-3 bg-rose-500/15 text-rose-200 font-bold text-sm rounded-2xl border border-rose-500/50 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {actionError}
        </div>
      )}

      {/* Filter + record bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/90 border border-slate-800/80 p-4 rounded-2xl">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-400 flex items-center gap-1"><Filter className="w-3.5 h-3.5 text-amber-500" /> Type:</span>
          {["All", "scrap", "rework"].map(t => (
            <button key={t} onClick={() => setTypeFilter(t)} className={`px-3 py-1 rounded-xl text-xs font-bold transition capitalize ${typeFilter === t ? "bg-blue-600 text-white" : "bg-slate-950/60 text-slate-300 border border-slate-800 hover:bg-slate-800"}`}>{t}</button>
          ))}
          <span className="text-xs font-bold text-slate-400 ml-2">Status:</span>
          {DISPOSITIONS.map(d => (
            <button key={d} onClick={() => setDispFilter(d)} className={`px-3 py-1 rounded-xl text-xs font-bold transition ${dispFilter === d ? "bg-blue-600 text-white" : "bg-slate-950/60 text-slate-300 border border-slate-800 hover:bg-slate-800"}`}>{d}</button>
          ))}
        </div>
        <button onClick={() => setShowModal(true)} className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white font-extrabold px-4 py-2 rounded-xl shadow-lg shadow-blue-600/20 transition text-xs whitespace-nowrap">
          <Plus className="w-4 h-4 stroke-[2.5]" /> Record Defect
        </button>
      </div>

      {/* Events list */}
      {loading ? (
        <div className="text-slate-400 animate-pulse font-medium p-6">Loading quality records...</div>
      ) : events.length === 0 ? (
        <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-16 text-center">
          <CheckCircle2 className="w-16 h-16 text-emerald-500 mx-auto mb-4 stroke-[1.5]" />
          <h3 className="text-xl font-black text-white mb-1">No defects recorded</h3>
          <p className="text-sm text-slate-400">Scrap and rework events will appear here as operators and QA flag them.</p>
        </div>
      ) : (
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-800">
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Order / Step</th>
                  <th className="px-4 py-3">Station</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Cost</th>
                  <th className="px-4 py-3">Recorded</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e: any) => (
                  <tr key={e.id} className="border-b border-slate-800/60 hover:bg-slate-800/40 transition">
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-black uppercase px-2 py-1 rounded ${e.eventType === "scrap" ? "bg-rose-500/20 text-rose-300 border border-rose-500/40" : "bg-orange-500/20 text-orange-300 border border-orange-500/40"}`}>
                        {e.eventType}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => onSelectOrder(e.orderId)} className="font-mono text-sm font-black text-amber-400 hover:text-amber-300">{e.orderNumber}</button>
                      <div className="text-[11px] text-slate-400 truncate max-w-[180px]">{e.operationName || e.orderTitle || "—"}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-300">{e.machineCode || "—"}</td>
                    <td className="px-4 py-3 text-right font-black text-white">{e.quantity} <span className="text-[10px] text-slate-500 font-normal">{e.unit}</span></td>
                    <td className="px-4 py-3 text-xs text-slate-300 max-w-[160px] truncate">{e.reason}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${e.disposition === "Scrapped" ? "bg-rose-500/20 text-rose-300" : e.disposition === "Reworked & Passed" ? "bg-emerald-500/20 text-emerald-300" : "bg-orange-500/20 text-orange-300"}`}>{e.disposition}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-slate-300">${parseFloat(e.estimatedCost || "0").toFixed(2)}</td>
                    <td className="px-4 py-3 text-[11px] text-slate-400 whitespace-nowrap">
                      <div>{e.recordedByName || "—"}</div>
                      <div>{new Date(e.createdAt).toLocaleString()}</div>
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {e.eventType === "rework" && (e.disposition === "Open" || e.disposition === "In Rework") && (
                        <>
                          <button onClick={() => handleDisposition(e.id, "Reworked & Passed")} disabled={busyId === e.id} className="text-[11px] font-bold bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 px-2 py-1 rounded hover:bg-emerald-500 hover:text-slate-950 transition disabled:opacity-40">
                            Passed
                          </button>
                          <button onClick={() => handleDisposition(e.id, "Scrapped")} disabled={busyId === e.id} className="ml-1.5 text-[11px] font-bold bg-rose-500/15 text-rose-300 border border-rose-500/40 px-2 py-1 rounded hover:bg-rose-500 hover:text-slate-950 transition disabled:opacity-40">
                            Scrap
                          </button>
                        </>
                      )}
                      {currentUser?.role === "Manager" && (
                        <button onClick={() => handleDelete(e.id)} className="ml-1.5 p-1.5 text-slate-600 hover:text-rose-400 hover:bg-rose-500/20 rounded transition" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Record defect modal */}
      {showModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/50">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Flame className="w-5 h-5 text-orange-400" /> Record Scrap / Rework
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <form onSubmit={submitEvent} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => setEventType("scrap")} className={`p-3 rounded-xl border-2 text-sm font-black uppercase tracking-wide transition ${eventType === "scrap" ? "bg-rose-500 text-slate-950 border-rose-300" : "bg-slate-950 border-slate-700 text-slate-300"}`}>
                  <Trash2 className="w-4 h-4 inline mr-1.5" /> Scrap
                </button>
                <button type="button" onClick={() => setEventType("rework")} className={`p-3 rounded-xl border-2 text-sm font-black uppercase tracking-wide transition ${eventType === "rework" ? "bg-orange-500 text-slate-950 border-orange-300" : "bg-slate-950 border-slate-700 text-slate-300"}`}>
                  <RefreshCw className="w-4 h-4 inline mr-1.5" /> Rework
                </button>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Order *</label>
                <select value={orderId} onChange={e => setOrderId(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" required>
                  <option value="">Select order...</option>
                  {orders.map(o => <option key={o.id} value={o.id}>{o.orderNumber} — {o.title}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Quantity</label>
                  <input type="number" min="1" value={quantity} onChange={e => setQuantity(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Unit</label>
                  <input type="text" value={unit} onChange={e => setUnit(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">Cost / unit ($)</label>
                  <input type="number" step="0.01" value={cost} onChange={e => setCost(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Defect reason *</label>
                <select value={reason} onChange={e => setReason(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white">
                  {REJECT_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Machine (optional)</label>
                <select value={machineId} onChange={e => setMachineId(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white">
                  <option value="">None</option>
                  {machines.map(m => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional detail on the defect or rework path..." className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white h-16" />
              </div>

              <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl transition">Cancel</button>
                <button type="submit" className="px-6 py-2 bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-blue-600/30 transition">Record Defect</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
