"use client";

import React, { useState, useEffect } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Play,
  Square,
  Trash2,
  Zap,
} from "lucide-react";

const DOWNTIME_REASONS = [
  "Mechanical Failure",
  "Electrical Fault",
  "Material Shortage",
  "Setup & Changeover",
  "Operator Unavailable",
  "Quality Issue",
  "Other",
];

interface DowntimeViewProps {
  currentUser: any;
}

function fmtDur(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function DowntimeView({ currentUser }: DowntimeViewProps) {
  const [events, setEvents] = useState<any[]>([]);
  const [machines, setMachines] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [tick, setTick] = useState(() => Date.now());

  // Start-downtime form
  const [machineId, setMachineId] = useState("");
  const [reason, setReason] = useState(DOWNTIME_REASONS[0]);
  const [orderId, setOrderId] = useState("");
  const [notes, setNotes] = useState("");

  const fetchEvents = async () => {
    try {
      const res = await fetch("/api/downtime", { cache: "no-store" });
      if (res.ok) setEvents(await res.json());
    } catch (err) {
      console.error("Failed to fetch downtime", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
    const interval = setInterval(fetchEvents, 10000);
    const clock = setInterval(() => setTick(Date.now()), 1000);
    return () => { clearInterval(interval); clearInterval(clock); };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [mRes, oRes] = await Promise.all([fetch("/api/machines"), fetch("/api/orders")]);
        if (mRes.ok) setMachines(await mRes.json());
        if (oRes.ok) setOrders(await oRes.json());
      } catch (err) {
        console.error("Failed to load reference data", err);
      }
    })();
  }, []);

  const startDowntime = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!machineId) {
      setError("Choose a machine before starting downtime.");
      return;
    }
    try {
      const res = await fetch("/api/downtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machineId: Number(machineId),
          reason,
          orderId: orderId ? Number(orderId) : null,
          notes: notes || undefined,
        }),
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p.error || "Failed to start downtime");
      }
      setMachineId("");
      setOrderId("");
      setNotes("");
      setReason(DOWNTIME_REASONS[0]);
      await fetchEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start downtime");
    }
  };

  const endDowntime = async (id: number) => {
    setBusyId(id);
    setError("");
    try {
      const res = await fetch(`/api/downtime/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ end: true }),
      });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p.error || "Failed to end downtime");
      }
      await fetchEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end downtime");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("Delete this downtime record?")) return;
    try {
      const res = await fetch(`/api/downtime/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const p = await res.json().catch(() => ({}));
        throw new Error(p.error || "Delete failed");
      }
      await fetchEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const openEvents = events.filter(e => !e.endedAt);
  const closedEvents = events.filter(e => e.endedAt);
  const now = tick;
  const totalTodayMinutes = closedEvents
    .filter(e => new Date(e.startedAt).toDateString() === new Date().toDateString())
    .reduce((s, e) => s + (e.durationMinutes || 0), 0);

  const startDowntimeAllowed = currentUser?.role === "Manager" || currentUser?.role === "Machine Operator" || currentUser?.role === "Technician";

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Machines Down Now</div>
          <div className={`text-2xl font-black mt-1 ${openEvents.length > 0 ? "text-rose-400" : "text-emerald-400"}`}>{openEvents.length}</div>
        </div>
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Downtime Today</div>
          <div className="text-2xl font-black text-white mt-1">{fmtDur(totalTodayMinutes)}</div>
        </div>
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Stoppages (total)</div>
          <div className="text-2xl font-black text-white mt-1">{events.length}</div>
        </div>
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Avg. Stoppage</div>
          <div className="text-2xl font-black text-white mt-1">
            {closedEvents.length > 0 ? fmtDur(Math.round(closedEvents.reduce((s, e) => s + e.durationMinutes, 0) / closedEvents.length)) : "—"}
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3 bg-rose-500/15 text-rose-200 font-bold text-sm rounded-2xl border border-rose-500/50 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Start downtime */}
        <div className="lg:col-span-1 bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
          <h3 className="text-sm font-black text-white uppercase tracking-wider mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-rose-400" /> Start Downtime
          </h3>
          {startDowntimeAllowed ? (
            <form onSubmit={startDowntime} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Machine *</label>
                <select value={machineId} onChange={e => setMachineId(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white" required>
                  <option value="">Select machine...</option>
                  {machines.map(m => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Reason *</label>
                <select value={reason} onChange={e => setReason(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white">
                  {DOWNTIME_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Affected order (optional)</label>
                <select value={orderId} onChange={e => setOrderId(e.target.value)} className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white">
                  <option value="">None</option>
                  {orders.map(o => <option key={o.id} value={o.id}>{o.orderNumber} — {o.title}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Notes</label>
                <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="What failed, what's being done..." className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-white h-16" />
              </div>
              <button type="submit" className="w-full flex items-center justify-center gap-2 bg-rose-500 hover:bg-rose-400 text-slate-950 font-extrabold text-xs py-3 rounded-xl transition uppercase tracking-wider">
                <Play className="w-4 h-4 fill-slate-950" /> Machine Down
              </button>
            </form>
          ) : (
            <p className="text-xs text-slate-400">Your role can view downtime but not start it. Ask a manager, operator or technician.</p>
          )}
        </div>

        {/* Lists */}
        <div className="lg:col-span-2 space-y-6">
          {/* Open events */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
            <h3 className="text-sm font-black text-white uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-60" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500" /></span>
              Currently Down
            </h3>
            {openEvents.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-500 flex flex-col items-center gap-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500" /> All stations operational.
              </div>
            ) : (
              <div className="space-y-2.5">
                {openEvents.map((e: any) => (
                  <div key={e.id} className="p-4 bg-rose-500/10 border border-rose-500/40 rounded-xl flex items-center justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-black text-rose-300">{e.machineCode}</span>
                        <span className="text-xs text-slate-400 truncate">{e.machineName}</span>
                      </div>
                      <div className="text-xs font-bold text-rose-200 mt-1">{e.reason}</div>
                      <div className="text-[11px] text-rose-300/70 mt-0.5 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> Down for {fmtDur(Math.round((now - new Date(e.startedAt).getTime()) / 60000))}
                      </div>
                      {e.notes && <div className="text-[11px] text-slate-400 mt-1 truncate">{e.notes}</div>}
                    </div>
                    <button onClick={() => endDowntime(e.id)} disabled={busyId === e.id} className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-xs px-4 py-3 rounded-xl transition uppercase tracking-wider disabled:opacity-40 whitespace-nowrap">
                      <Square className="w-4 h-4 fill-slate-950" /> Back Up
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* History */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
            <h3 className="text-sm font-black text-white uppercase tracking-wider mb-3">Downtime History</h3>
            {loading ? (
              <div className="text-slate-400 animate-pulse font-medium">Loading...</div>
            ) : closedEvents.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-500">No closed stoppages yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-800">
                      <th className="px-3 py-2">Machine</th>
                      <th className="px-3 py-2">Reason</th>
                      <th className="px-3 py-2">Started</th>
                      <th className="px-3 py-2">Ended</th>
                      <th className="px-3 py-2 text-right">Duration</th>
                      <th className="px-3 py-2">Order</th>
                      <th className="px-3 py-2 text-right">By</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedEvents.map((e: any) => (
                      <tr key={e.id} className="border-b border-slate-800/60 hover:bg-slate-800/40">
                        <td className="px-3 py-2.5 font-mono text-xs font-black text-amber-400">{e.machineCode}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-300 max-w-[160px] truncate">{e.reason}</td>
                        <td className="px-3 py-2.5 text-[11px] text-slate-400 whitespace-nowrap">{new Date(e.startedAt).toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-[11px] text-slate-400 whitespace-nowrap">{new Date(e.endedAt).toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-white">{fmtDur(e.durationMinutes || 0)}</td>
                        <td className="px-3 py-2.5 font-mono text-[11px] text-slate-400">{e.orderNumber || "—"}</td>
                        <td className="px-3 py-2.5 text-right text-[11px] text-slate-400">{e.operatorName || "—"}</td>
                        <td className="px-3 py-2.5 text-right">
                          {currentUser?.role === "Manager" && (
                            <button onClick={() => handleDelete(e.id)} className="p-1.5 text-slate-600 hover:text-rose-400 hover:bg-rose-500/20 rounded transition"><Trash2 className="w-3.5 h-3.5" /></button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
