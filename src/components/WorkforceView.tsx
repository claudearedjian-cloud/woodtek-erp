"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Clock,
  LogIn,
  LogOut,
  Plus,
  Trash2,
  X,
  User,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Timer,
  Users,
  CalendarClock,
  Sparkles,
} from "lucide-react";

interface WorkforceViewProps {
  currentUser: any;
  machines?: any[];
}

const SHIFT_COLORS = [
  "bg-amber-500",
  "bg-blue-500",
  "bg-emerald-500",
  "bg-purple-500",
  "bg-rose-500",
  "bg-teal-500",
];

function toYMD(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDur(min: number | null | undefined): string {
  if (min === null || min === undefined) return "—";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function weekDates(weekStart: Date): Date[] {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(weekStart.getDate() + i);
    return d;
  });
}

export default function WorkforceView({ currentUser, machines = [] }: WorkforceViewProps) {
  const isManager = currentUser?.role === "Manager";

  const [tab, setTab] = useState<"planner" | "attendance">("planner");

  // ---- Shift definitions ----
  const [shifts, setShifts] = useState<any[]>([]);
  const [newShift, setNewShift] = useState({ name: "", startTime: "06:00", endTime: "14:00", color: SHIFT_COLORS[0] });

  // ---- Planner ----
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const d = new Date();
    const day = (d.getDay() + 6) % 7; // Monday=0
    d.setDate(d.getDate() - day);
    return d;
  });
  const [assignments, setAssignments] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [assignForm, setAssignForm] = useState<{ date: string; userId: string; shiftId: string; machineId: string } | null>(null);

  // ---- Attendance ----
  const [todayRows, setTodayRows] = useState<any[]>([]);
  const [weekRows, setWeekRows] = useState<any[]>([]);
  const [myOpen, setMyOpen] = useState<any | null>(null);

  const [loading, setLoading] = useState(false);
  const [flash, setFlash] = useState("");
  const [error, setError] = useState("");

  const flashMsg = (m: string) => { setFlash(m); setTimeout(() => setFlash(""), 3500); };

  const loadShifts = useCallback(async () => {
    try {
      const res = await fetch("/api/shifts", { cache: "no-store" });
      if (res.ok) setShifts(await res.json());
    } catch { /* ignore */ }
  }, []);

  const loadAssignments = useCallback(async (ws: Date) => {
    const from = toYMD(ws);
    const toD = new Date(ws); toD.setDate(ws.getDate() + 6);
    const to = toYMD(toD);
    try {
      const res = await fetch(`/api/shifts/assignments?from=${from}&to=${to}`, { cache: "no-store" });
      if (res.ok) setAssignments(await res.json());
    } catch { /* ignore */ }
  }, []);

  const loadAttendance = useCallback(async (ws: Date) => {
    const today = toYMD(new Date());
    const from = toYMD(ws);
    const toD = new Date(ws); toD.setDate(ws.getDate() + 6);
    const to = toYMD(toD);
    try {
      const [tRes, wRes] = await Promise.all([
        fetch(`/api/attendance?date=${today}`, { cache: "no-store" }),
        fetch(`/api/attendance?from=${from}&to=${to}`, { cache: "no-store" }),
      ]);
      if (tRes.ok) setTodayRows(await tRes.json());
      if (wRes.ok) setWeekRows(await wRes.json());
    } catch { /* ignore */ }
  }, []);

  const loadUsers = useCallback(async () => {
    if (!isManager) return;
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      if (res.ok) setUsers(await res.json());
    } catch { /* ignore */ }
  }, [isManager]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadShifts(), loadAssignments(weekStart), loadAttendance(weekStart), loadUsers()]);
    setLoading(false);
  }, [loadShifts, loadAssignments, loadAttendance, loadUsers, weekStart]);

  useEffect(() => { refresh(); }, [refresh]);

  // Derive the current user's open clock record
  useEffect(() => {
    const mine = todayRows.find((r: any) => Number(r.userId) === Number(currentUser?.id) && !r.clockOut);
    setMyOpen(mine || null);
  }, [todayRows, currentUser]);

  const days = useMemo(() => weekDates(weekStart), [weekStart]);
  const weekLabel = `${days[0].toLocaleDateString([], { day: "numeric", month: "short" })} – ${days[6].toLocaleDateString([], { day: "numeric", month: "short" })}`;

  // ---------------- Shift CRUD ----------------
  const handleAddShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newShift.name.trim()) return;
    setError("");
    try {
      const res = await fetch("/api/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newShift),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to create shift.");
      setNewShift({ name: "", startTime: "06:00", endTime: "14:00", color: SHIFT_COLORS[shifts.length % SHIFT_COLORS.length] });
      flashMsg(`Shift "${payload.name}" created.`);
      await loadShifts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create shift.");
    }
  };

  const handleDeleteShift = async (id: number) => {
    if (!confirm("Delete this shift definition?")) return;
    try {
      const res = await fetch(`/api/shifts?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete shift.");
      flashMsg("Shift deleted.");
      await loadShifts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete shift.");
    }
  };

  // ---------------- Assignments ----------------
  const openAssign = (date: string) => {
    setAssignForm({ date, userId: "", shiftId: "", machineId: "" });
    setError("");
  };

  const handleSaveAssignment = async () => {
    if (!assignForm || !assignForm.userId || !assignForm.shiftId) {
      setError("Pick an employee and a shift.");
      return;
    }
    try {
      const res = await fetch("/api/shifts/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: Number(assignForm.userId),
          shiftId: Number(assignForm.shiftId),
          workDate: assignForm.date,
          machineId: assignForm.machineId ? Number(assignForm.machineId) : null,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to save assignment.");
      flashMsg("Shift assignment saved.");
      setAssignForm(null);
      await loadAssignments(weekStart);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save assignment.");
    }
  };

  const handleDeleteAssignment = async (id: number) => {
    if (!confirm("Remove this shift assignment?")) return;
    try {
      const res = await fetch(`/api/shifts/assignments?id=${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to remove assignment.");
      flashMsg("Assignment removed.");
      await loadAssignments(weekStart);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove assignment.");
    }
  };

  // ---------------- Attendance ----------------
  const handleClockIn = async () => {
    setError("");
    try {
      const res = await fetch("/api/attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clockIn: true }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to clock in.");
      flashMsg("Clocked in. Welcome!");
      await loadAttendance(weekStart);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clock in.");
    }
  };

  const handleClockOut = async () => {
    setError("");
    try {
      const res = await fetch("/api/attendance", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clockOut: true }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || "Failed to clock out.");
      flashMsg("Clocked out. Good shift!");
      await loadAttendance(weekStart);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clock out.");
    }
  };

  // Weekly hours summary (Manager view): user -> total worked minutes
  const weeklySummary = useMemo(() => {
    const map = new Map<number, { name: string; role: string; minutes: number; avatarColor: string }>();
    for (const r of weekRows as any[]) {
      if (!r.workedMinutes) continue;
      const cur = map.get(r.userId) || { name: r.userName || `#${r.userId}`, role: r.userRole || "", minutes: 0, avatarColor: r.avatarColor || "bg-slate-600" };
      cur.minutes += r.workedMinutes;
      map.set(r.userId, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.minutes - a.minutes);
  }, [weekRows]);

  const isToday = (d: Date) => toYMD(d) === toYMD(new Date());

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800/80 p-5 rounded-2xl shadow-sm">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CalendarClock className="w-5 h-5 text-amber-400" />
            <span className="text-xs font-black uppercase tracking-widest text-amber-400 bg-amber-500/10 px-2.5 py-0.5 rounded border border-amber-500/30">
              Workforce &amp; Shifts
            </span>
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">Production Calendar &amp; Time Tracking</h2>
          <p className="text-xs text-slate-400 font-semibold mt-1">
            Plan who works which shift, and clock the floor in and out.
          </p>
        </div>
        <button
          onClick={() => refresh()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-slate-950 border border-slate-700 hover:border-amber-500/50 text-slate-300 rounded-xl text-xs font-bold transition"
        >
          <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-amber-400" : ""}`} /> Refresh
        </button>
      </div>

      {flash && (
        <div className="p-3 bg-emerald-500/15 border border-emerald-500/50 rounded-2xl text-emerald-300 font-black text-sm text-center flex items-center justify-center gap-2">
          <Sparkles className="w-5 h-5" /> {flash}
        </div>
      )}
      {error && (
        <div className="p-3 bg-rose-500/15 border border-rose-500/50 rounded-2xl text-rose-200 font-bold text-sm text-center">
          {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 bg-slate-950 p-1.5 rounded-xl border border-slate-800 w-fit">
        <button
          onClick={() => setTab("planner")}
          className={`px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition ${tab === "planner" ? "bg-amber-600 text-white shadow-sm" : "text-slate-400 hover:text-white"}`}
        >
          <CalendarDays className="w-4 h-4" /> Shift Planner
        </button>
        <button
          onClick={() => setTab("attendance")}
          className={`px-4 py-2 rounded-lg font-bold text-xs flex items-center gap-2 transition ${tab === "attendance" ? "bg-amber-600 text-white shadow-sm" : "text-slate-400 hover:text-white"}`}
        >
          <Clock className="w-4 h-4" /> Time &amp; Attendance
        </button>
      </div>

      {/* ================= TAB 1: SHIFT PLANNER ================= */}
      {tab === "planner" && (
        <div className="space-y-6">
          {/* Week navigation */}
          <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4">
            <button
              onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d); }}
              className="p-2 bg-slate-950 border border-slate-700 hover:border-amber-500/50 text-slate-300 rounded-xl transition"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="text-sm font-black text-white uppercase tracking-wider">{weekLabel}</div>
            <button
              onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d); }}
              className="p-2 bg-slate-950 border border-slate-700 hover:border-amber-500/50 text-slate-300 rounded-xl transition"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Week grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
            {days.map((d) => {
              const dateStr = toYMD(d);
              const dayAssignments = assignments.filter((a: any) => a.workDate === dateStr);
              return (
                <div key={dateStr} className={`rounded-2xl border p-3 min-h-40 ${isToday(d) ? "bg-amber-500/5 border-amber-500/40" : "bg-slate-900/80 border-slate-800"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className={`text-xs font-black uppercase ${isToday(d) ? "text-amber-400" : "text-slate-400"}`}>
                        {d.toLocaleDateString([], { weekday: "short" })}
                      </div>
                      <div className={`text-lg font-black ${isToday(d) ? "text-amber-300" : "text-white"}`}>{d.getDate()}</div>
                    </div>
                    {isManager && (
                      <button
                        onClick={() => openAssign(dateStr)}
                        className="p-1.5 bg-slate-950 border border-slate-700 hover:border-amber-500/60 hover:text-amber-300 text-slate-400 rounded-lg transition"
                        title="Assign shift"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    {dayAssignments.length === 0 && (
                      <div className="text-[10px] font-bold text-slate-600 text-center py-3">No assignments</div>
                    )}
                    {dayAssignments.map((a: any) => (
                      <div key={a.id} className="group relative bg-slate-950/80 border border-slate-700/70 rounded-xl px-2.5 py-2">
                        <div className="flex items-center gap-2">
                          <span className={`h-2.5 w-2.5 rounded-full ${a.shiftColor || "bg-amber-500"}`} />
                          <div className="min-w-0">
                            <div className="text-[11px] font-black text-white truncate">{a.userName}</div>
                            <div className="text-[10px] font-bold text-slate-400 truncate">
                              {a.shiftName} · {a.shiftStart}–{a.shiftEnd}
                              {a.machineCode ? ` · ${a.machineCode}` : ""}
                            </div>
                          </div>
                          {isManager && (
                            <button
                              onClick={() => handleDeleteAssignment(a.id)}
                              className="ml-auto opacity-0 group-hover:opacity-100 text-rose-400 hover:text-rose-300 transition"
                              title="Remove assignment"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Assign form (inline modal) */}
          {assignForm && (
            <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <Users className="w-4 h-4 text-amber-400" /> Assign Shift — {assignForm.date}
                  </h3>
                  <button onClick={() => setAssignForm(null)} className="text-slate-400 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase">Employee</label>
                    <select
                      value={assignForm.userId}
                      onChange={(e) => setAssignForm({ ...assignForm, userId: e.target.value })}
                      className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-semibold"
                    >
                      <option value="">Select employee…</option>
                      {users.map((u: any) => (
                        <option key={u.id} value={u.id}>{u.name} — {u.role}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase">Shift</label>
                    <select
                      value={assignForm.shiftId}
                      onChange={(e) => setAssignForm({ ...assignForm, shiftId: e.target.value })}
                      className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-semibold"
                    >
                      <option value="">Select shift…</option>
                      {shifts.map((s: any) => (
                        <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase">Station (optional)</label>
                    <select
                      value={assignForm.machineId}
                      onChange={(e) => setAssignForm({ ...assignForm, machineId: e.target.value })}
                      className="w-full mt-1 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-semibold"
                    >
                      <option value="">— None —</option>
                      {machines.map((m: any) => (
                        <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleSaveAssignment}
                      className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase rounded-xl transition active:scale-95"
                    >
                      Save Assignment
                    </button>
                    <button
                      onClick={() => setAssignForm(null)}
                      className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs uppercase rounded-xl transition"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Shift definitions */}
          {isManager && (
            <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5">
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2 mb-4">
                <Timer className="w-4 h-4 text-amber-400" /> Shift Definitions
              </h3>
              <div className="flex flex-wrap gap-2 mb-4">
                {shifts.map((s: any) => (
                  <div key={s.id} className="flex items-center gap-2 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2">
                    <span className={`h-3 w-3 rounded-full ${s.color || "bg-amber-500"}`} />
                    <span className="text-xs font-black text-white">{s.name}</span>
                    <span className="text-[10px] font-bold text-slate-400">{s.startTime}–{s.endTime}</span>
                    <button onClick={() => handleDeleteShift(s.id)} className="text-rose-400 hover:text-rose-300"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                {shifts.length === 0 && <div className="text-xs text-slate-500 font-semibold">No shifts defined yet — add one below.</div>}
              </div>
              <form onSubmit={handleAddShift} className="flex flex-wrap gap-2 items-end">
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Name</label>
                  <input
                    value={newShift.name}
                    onChange={(e) => setNewShift({ ...newShift, name: e.target.value })}
                    placeholder="e.g. Morning"
                    className="w-32 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-semibold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">Start</label>
                  <input
                    type="time"
                    value={newShift.startTime}
                    onChange={(e) => setNewShift({ ...newShift, startTime: e.target.value })}
                    className="w-28 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-semibold"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">End</label>
                  <input
                    type="time"
                    value={newShift.endTime}
                    onChange={(e) => setNewShift({ ...newShift, endTime: e.target.value })}
                    className="w-28 bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-semibold"
                  />
                </div>
                <button
                  type="submit"
                  className="px-4 py-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-black text-xs uppercase rounded-xl transition active:scale-95"
                >
                  + Add Shift
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 2: TIME & ATTENDANCE ================= */}
      {tab === "attendance" && (
        <div className="space-y-6">
          {/* Clock card */}
          <div className={`rounded-2xl border-2 p-6 ${myOpen ? "bg-emerald-500/10 border-emerald-500/50" : "bg-slate-900/90 border-slate-700"}`}>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className={`flex h-14 w-14 items-center justify-center rounded-2xl ${myOpen ? "bg-emerald-500 text-slate-950" : "bg-amber-500 text-slate-950"}`}>
                  {myOpen ? <LogOut className="w-7 h-7" /> : <LogIn className="w-7 h-7" />}
                </div>
                <div>
                  <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Welcome, {currentUser?.name}</div>
                  <div className="text-lg font-black text-white">
                    {myOpen ? (
                      <>Clocked in since <span className="text-emerald-400">{fmtTime(myOpen.clockIn)}</span></>
                    ) : (
                      "You are currently clocked out."
                    )}
                  </div>
                  {myOpen?.shiftName && (
                    <div className="text-xs font-bold text-slate-400">Shift: {myOpen.shiftName}</div>
                  )}
                </div>
              </div>
              {myOpen ? (
                <button
                  onClick={handleClockOut}
                  className="inline-flex items-center justify-center gap-2 bg-gradient-to-b from-rose-400 to-rose-600 hover:from-rose-500 hover:to-rose-700 active:scale-95 text-slate-950 font-black px-8 py-4 rounded-2xl text-sm uppercase tracking-wider shadow-xl shadow-rose-600/30 transition"
                >
                  <LogOut className="w-5 h-5" /> CLOCK OUT
                </button>
              ) : (
                <button
                  onClick={handleClockIn}
                  className="inline-flex items-center justify-center gap-2 bg-gradient-to-b from-emerald-400 to-emerald-600 hover:from-emerald-500 hover:to-emerald-700 active:scale-95 text-slate-950 font-black px-8 py-4 rounded-2xl text-sm uppercase tracking-wider shadow-xl shadow-emerald-600/30 transition"
                >
                  <LogIn className="w-5 h-5" /> CLOCK IN
                </button>
              )}
            </div>
          </div>

          {/* Today's attendance */}
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5">
            <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-amber-400" /> Today's Attendance
            </h3>
            {todayRows.length === 0 ? (
              <div className="text-xs text-slate-500 font-semibold py-6 text-center">No clock records for today yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[10px] font-black uppercase tracking-wider text-slate-500 border-b border-slate-800">
                      <th className="py-2 pr-3">Employee</th>
                      <th className="py-2 pr-3">Shift</th>
                      <th className="py-2 pr-3">Clock In</th>
                      <th className="py-2 pr-3">Clock Out</th>
                      <th className="py-2 pr-3">Worked</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {(todayRows as any[]).map((r) => (
                      <tr key={r.id} className="text-slate-200">
                        <td className="py-2.5 pr-3">
                          <span className={`inline-flex h-6 w-6 items-center justify-center rounded-lg ${r.avatarColor || "bg-slate-600"} text-[10px] font-black text-white mr-2`}>
                            {(r.userName || "?").charAt(0)}
                          </span>
                          <span className="font-bold text-white">{r.userName}</span>
                          <span className="text-slate-500 font-semibold"> · {r.userRole}</span>
                        </td>
                        <td className="py-2.5 pr-3 text-slate-400 font-semibold">{r.shiftName || "—"}</td>
                        <td className="py-2.5 pr-3 font-mono font-bold text-emerald-300">{fmtTime(r.clockIn)}</td>
                        <td className="py-2.5 pr-3 font-mono font-bold text-rose-300">{fmtTime(r.clockOut)}</td>
                        <td className="py-2.5 pr-3 font-bold text-amber-300">{fmtDur(r.workedMinutes)}</td>
                        <td className="py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${r.status === "Present" ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
                            {r.clockOut ? "Done" : r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Weekly summary (Manager) */}
          {isManager && (
            <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5">
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2 mb-4">
                <Users className="w-4 h-4 text-amber-400" /> Weekly Hours ({weekLabel})
              </h3>
              {weeklySummary.length === 0 ? (
                <div className="text-xs text-slate-500 font-semibold py-6 text-center">No clock records in this week yet.</div>
              ) : (
                <div className="space-y-2">
                  {weeklySummary.map((u) => (
                    <div key={u.name} className="flex items-center gap-3 bg-slate-950/70 border border-slate-800 rounded-xl px-3 py-2.5">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${u.avatarColor || "bg-slate-600"} text-[11px] font-black text-white`}>{u.name.charAt(0)}</span>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-black text-white truncate">{u.name}</div>
                        <div className="text-[10px] font-bold text-slate-500">{u.role}</div>
                      </div>
                      <div className="h-2 flex-1 max-w-40 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-amber-500 to-amber-300 rounded-full"
                          style={{ width: `${Math.min(100, Math.round((u.minutes / (40 * 60)) * 100))}%` }}
                        />
                      </div>
                      <div className="text-xs font-black text-amber-300 w-20 text-right">{fmtDur(u.minutes)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
