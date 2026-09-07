"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Cpu,
  GripVertical,
  ListFilter,
  Plus,
  RefreshCw,
  Route,
  Trash2,
  X,
} from "lucide-react";

interface ScheduleViewProps {
  machines: any[];
  currentUser: any;
  onRefresh: () => void;
  searchQuery?: string;
}

function localDateKey(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function timeValue(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function toDateTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`);
}

export default function ScheduleView({ machines = [], currentUser, onRefresh, searchQuery = "" }: ScheduleViewProps) {
  const [operations, setOperations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [plannerOp, setPlannerOp] = useState<any>(null);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleTime, setScheduleTime] = useState("08:00");
  const [plannerMachineId, setPlannerMachineId] = useState("");
  const [saving, setSaving] = useState(false);

  const canSchedule = currentUser?.role === "Manager" || currentUser?.role === "Sales Coordinator";

  const fetchOperations = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const response = await fetch("/api/operations", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}. Please check your login session.`);
      }
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Invalid response format received from server. Please refresh.");
      }
      const payload = await response.json();
      setOperations(payload);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Unable to load dispatch schedule.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchOperations();
    const interval = setInterval(() => fetchOperations(true), 20000);
    return () => clearInterval(interval);
  }, []);

  const days = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 5 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return { date, key: localDateKey(date) };
    });
  }, []);

  const visibleOperations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return operations.filter(operation => {
      if (operation.status === "Completed") return false;
      if (!query) return true;
      return [operation.orderNumber, operation.orderTitle, operation.operationName, operation.machineCode]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(query));
    });
  }, [operations, searchQuery]);

  const unscheduled = visibleOperations.filter(operation => !operation.scheduledStart);
  const scheduled = visibleOperations.filter(operation => Boolean(operation.scheduledStart));

  const openPlanner = (operation: any) => {
    const defaultDate = operation.scheduledStart ? localDateKey(operation.scheduledStart) : localDateKey(new Date());
    const defaultTime = operation.scheduledStart ? timeValue(operation.scheduledStart) : "08:00";
    setPlannerOp(operation);
    setScheduleDate(defaultDate);
    setScheduleTime(defaultTime);
    setPlannerMachineId(String(operation.machineId || machines.find(machine => machine.status !== "Maintenance" && machine.status !== "Offline")?.id || ""));
    setError("");
  };

  const saveSchedule = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!plannerOp || !plannerMachineId || !scheduleDate || !scheduleTime) return;
    setSaving(true);
    setError("");
    const start = toDateTime(scheduleDate, scheduleTime);
    const end = new Date(start.getTime() + Number(plannerOp.estimatedMinutes || 60) * 60 * 1000);

    try {
      const response = await fetch(`/api/operations/${plannerOp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machineId: Number(plannerMachineId),
          scheduledStart: start.toISOString(),
          scheduledEnd: end.toISOString(),
        }),
      });
      if (!response.ok) {
        let errorMsg = "This slot could not be scheduled.";
        try {
          const payload = await response.json();
          errorMsg = payload.error || errorMsg;
        } catch (e) {
          errorMsg = `Server error (Status ${response.status}).`;
        }
        throw new Error(errorMsg);
      }
      const contentType = response.headers.get("content-type") || "";
      let payload;
      if (contentType.includes("application/json")) {
        payload = await response.json();
      }
      setPlannerOp(null);
      setNotice(`${plannerOp.operationName} scheduled on ${machines.find(machine => String(machine.id) === plannerMachineId)?.code || "machine"}.`);
      setTimeout(() => setNotice(""), 4500);
      await fetchOperations(true);
      onRefresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "This slot could not be scheduled.");
    } finally {
      setSaving(false);
    }
  };

  const clearSchedule = async (operation: any) => {
    if (!confirm(`Remove the dispatch booking for ${operation.operationName}?`)) return;
    setError("");
    try {
      const response = await fetch(`/api/operations/${operation.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledStart: null, scheduledEnd: null }),
      });
      if (!response.ok) {
        let errorMsg = "Unable to clear booking.";
        try {
          const payload = await response.json();
          errorMsg = payload.error || errorMsg;
        } catch (e) {
          errorMsg = `Server error (Status ${response.status}).`;
        }
        throw new Error(errorMsg);
      }
      setNotice("Dispatch booking cleared. The operation is back in the unscheduled queue.");
      setTimeout(() => setNotice(""), 4500);
      await fetchOperations(true);
      onRefresh();
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Unable to clear booking.");
    }
  };

  const statusClass = (status: string) => {
    if (status === "In Progress") return "border-amber-500/40 bg-amber-500/10 text-amber-200";
    if (status === "Ready") return "border-blue-500/30 bg-blue-500/10 text-blue-200";
    if (status === "Rejected/Rework") return "border-rose-500/40 bg-rose-500/10 text-rose-200";
    return "border-slate-700 bg-slate-950/60 text-slate-300";
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
          <h2 className="text-sm font-black tracking-wide text-slate-300">Loading dispatch board…</h2>
        </div>
        <div className="h-20 animate-pulse rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />
        <div className="grid animate-pulse gap-4 lg:grid-cols-[280px_1fr]">
          <div className="h-72 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />
          <div className="h-72 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-amber-400">
            <CalendarDays className="h-4 w-4" /> Dispatch planning board
          </div>
          <h1 className="text-xl font-black tracking-tight text-white sm:text-2xl">Machine lanes & production appointments</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">Plan each routed step against a real machine and time window. Conflicting bookings and unavailable stations are rejected by the server before they reach the floor.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Open work</div>
            <div className="font-mono text-lg font-black text-white">{visibleOperations.length}</div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Unscheduled</div>
            <div className={`font-mono text-lg font-black ${unscheduled.length ? "text-amber-400" : "text-emerald-400"}`}>{unscheduled.length}</div>
          </div>
          <button onClick={() => fetchOperations(true)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300 transition hover:border-amber-500/50 hover:text-white" title="Refresh schedule">
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin text-amber-400" : ""}`} />
          </button>
        </div>
      </div>

      {(error || notice) && (
        <div className={`flex items-center justify-between gap-3 rounded-xl border p-3 text-xs font-bold ${error ? "border-rose-500/40 bg-rose-500/10 text-rose-200" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"}`} role="status">
          <span className="flex items-center gap-2">{error ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}{error || notice}</span>
          <button onClick={() => { setError(""); setNotice(""); }} className="rounded-lg p-1 hover:bg-white/10"><X className="h-4 w-4" /></button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <section className="h-fit rounded-2xl border border-slate-800/80 bg-slate-900/90 p-4 shadow-sm xl:sticky xl:top-24">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-black text-white"><ListFilter className="h-4 w-4 text-amber-400" /> Needs a slot</h2>
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-black text-amber-300">{unscheduled.length}</span>
          </div>
          {unscheduled.length === 0 ? (
            <div className="rounded-xl border border-dashed border-emerald-500/30 bg-emerald-500/5 p-5 text-center text-xs text-emerald-200">
              <CheckCircle2 className="mx-auto mb-2 h-7 w-7 text-emerald-400" />
              All open operations have a dispatch slot.
            </div>
          ) : (
            <div className="space-y-2.5">
              {unscheduled.map(operation => (
                <OperationCard key={operation.id} operation={operation} statusClass={statusClass} canSchedule={canSchedule} onPlan={() => openPlanner(operation)} onClear={() => clearSchedule(operation)} />
              ))}
            </div>
          )}
          {!canSchedule && <p className="mt-4 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-[11px] leading-relaxed text-slate-400">Read-only view. Manager and Sales Coordinator roles can create or change dispatch appointments.</p>}
        </section>

        <section className="min-w-0">
          <div className="mb-3 flex items-center justify-between px-1">
            <div className="flex items-center gap-2 text-sm font-black text-white"><Route className="h-4 w-4 text-blue-400" /> Five-day machine dispatch</div>
            <div className="text-[11px] font-semibold text-slate-500">Times shown in local shop time</div>
          </div>
          <div className="grid min-w-[980px] grid-cols-5 gap-3 overflow-x-auto pb-2 xl:min-w-0">
            {days.map(({ date, key }) => {
              const dayOperations = scheduled.filter(operation => localDateKey(operation.scheduledStart) === key).sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime());
              const isToday = key === localDateKey(new Date());
              return (
                <div key={key} className={`min-h-[560px] rounded-2xl border bg-slate-900/80 p-3 ${isToday ? "border-amber-500/50 shadow-lg shadow-amber-950/20" : "border-slate-800/80"}`}>
                  <div className="mb-3 border-b border-slate-800 pb-3">
                    <div className={`text-[10px] font-black uppercase tracking-widest ${isToday ? "text-amber-400" : "text-slate-500"}`}>{isToday ? "Today" : date.toLocaleDateString(undefined, { weekday: "short" })}</div>
                    <div className="text-sm font-black text-white">{date.toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
                    <div className="mt-1 text-[10px] font-semibold text-slate-500">{dayOperations.length} booked operation{dayOperations.length === 1 ? "" : "s"}</div>
                  </div>
                  <div className="space-y-2.5">
                    {dayOperations.map(operation => (
                      <OperationCard key={operation.id} operation={operation} statusClass={statusClass} canSchedule={canSchedule} onPlan={() => openPlanner(operation)} onClear={() => clearSchedule(operation)} compact />
                    ))}
                    {dayOperations.length === 0 && <div className="py-16 text-center text-[11px] font-medium italic text-slate-600">No appointments</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {plannerOp && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
          <form onSubmit={saveSchedule} className="w-full max-w-md space-y-4 rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
              <div>
                <div className="mb-1 font-mono text-xs font-black text-amber-400">{plannerOp.orderNumber}</div>
                <h3 className="text-base font-black text-white">Plan operation slot</h3>
                <p className="mt-1 text-xs text-slate-400">{plannerOp.operationName} · {plannerOp.estimatedMinutes} minutes</p>
              </div>
              <button type="button" onClick={() => setPlannerOp(null)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-bold text-slate-300">Machine station</label>
              <select value={plannerMachineId} onChange={event => setPlannerMachineId(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-amber-500 focus:outline-none" required>
                <option value="">Select an available station</option>
                {machines.map(machine => <option key={machine.id} value={machine.id} disabled={machine.status === "Maintenance" || machine.status === "Offline"}>{machine.code} · {machine.name} {machine.status === "Maintenance" || machine.status === "Offline" ? `(${machine.status})` : ""}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="mb-1.5 block text-xs font-bold text-slate-300">Production date</label><input type="date" value={scheduleDate} onChange={event => setScheduleDate(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-amber-500 focus:outline-none" required /></div>
              <div><label className="mb-1.5 block text-xs font-bold text-slate-300">Start time</label><input type="time" value={scheduleTime} onChange={event => setScheduleTime(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs text-white focus:border-amber-500 focus:outline-none" required /></div>
            </div>
            <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-3 text-xs leading-relaxed text-blue-100"><Clock3 className="mr-1 inline h-3.5 w-3.5 text-blue-300" /> The end time is calculated automatically from the estimated operation duration.</div>
            <div className="flex justify-end gap-2 border-t border-slate-800 pt-4"><button type="button" onClick={() => setPlannerOp(null)} className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-bold text-slate-300 hover:bg-slate-700">Cancel</button><button type="submit" disabled={saving} className="rounded-xl bg-amber-500 px-5 py-2 text-xs font-black text-slate-950 hover:bg-amber-400 disabled:opacity-50">{saving ? "Checking capacity…" : "Save dispatch slot"}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}

function OperationCard({ operation, statusClass, canSchedule, onPlan, onClear, compact = false }: { operation: any; statusClass: (status: string) => string; canSchedule: boolean; onPlan: () => void; onClear: () => void; compact?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 transition hover:border-slate-600 ${statusClass(operation.status)}`}>
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2"><span className="font-mono text-[10px] font-black text-amber-300">{operation.orderNumber}</span><span className="text-[10px] font-bold text-slate-400">{operation.scheduledStart ? timeValue(operation.scheduledStart) : "Unplanned"}</span></div>
          <div className="mt-1 line-clamp-2 text-xs font-black text-white">{operation.operationName}</div>
          <div className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-slate-400"><Cpu className="h-3 w-3 text-blue-300" />{operation.machineCode || "No station"} · {operation.estimatedMinutes}m</div>
          {!compact && <div className="mt-1 truncate text-[10px] text-slate-500">{operation.orderTitle}</div>}
        </div>
      </div>
      {canSchedule && <div className="mt-2 flex items-center gap-1.5 border-t border-white/10 pt-2"><button onClick={onPlan} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-slate-950/60 px-2 py-1.5 text-[10px] font-black text-white hover:bg-slate-950"><Plus className="h-3 w-3 text-amber-400" />{operation.scheduledStart ? "Reschedule" : "Plan slot"}</button>{operation.scheduledStart && <button onClick={onClear} className="rounded-lg bg-slate-950/60 p-1.5 text-slate-400 hover:text-rose-300" title="Clear slot"><Trash2 className="h-3 w-3" /></button>}</div>}
    </div>
  );
}
