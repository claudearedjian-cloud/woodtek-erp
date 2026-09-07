"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  GanttChartSquare,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Cpu,
  ClipboardList,
  CalendarDays,
  AlertTriangle,
  Layers,
  Clock,
} from "lucide-react";

interface GanttViewProps {
  machines: any[];
  onSelectOrder: (orderId: number) => void;
  searchQuery?: string;
}

const LABEL_WIDTH = "w-44 sm:w-52";

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function startOfDay(d: Date) {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function fmtTime(value: string | null | undefined) {
  if (!value) return "";
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function fmtDayLabel(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

const STATUS_COLORS: Record<string, { bar: string; dot: string; text: string }> = {
  "In Progress": { bar: "bg-gradient-to-r from-amber-500 to-amber-400 border-amber-300", dot: "bg-amber-400", text: "text-amber-300" },
  Ready: { bar: "bg-gradient-to-r from-blue-600 to-blue-400 border-blue-300", dot: "bg-blue-400", text: "text-blue-300" },
  Pending: { bar: "bg-gradient-to-r from-slate-600 to-slate-500 border-slate-400", dot: "bg-slate-400", text: "text-slate-300" },
  Completed: { bar: "bg-gradient-to-r from-emerald-700 to-emerald-600 border-emerald-400 opacity-70", dot: "bg-emerald-400", text: "text-emerald-300" },
  "Rejected/Rework": { bar: "bg-gradient-to-r from-rose-600 to-rose-500 border-rose-300", dot: "bg-rose-400", text: "text-rose-300" },
};

function colorFor(status: string) {
  return STATUS_COLORS[status] ?? STATUS_COLORS.Pending;
}

export default function GanttView({ machines = [], onSelectOrder, searchQuery = "" }: GanttViewProps) {
  const [operations, setOperations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"order" | "machine">("order");
  const [dayCount, setDayCount] = useState(7);
  const [viewStart, setViewStart] = useState(() => startOfDay(new Date()));
  const [hoverBar, setHoverBar] = useState<number | null>(null);

  const fetchOps = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/operations", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}. Please check your login session.`);
      }
      const contentType = res.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Invalid response format received from server. Please refresh.");
      }
      const payload = await res.json();
      setOperations(payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load schedule data.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchOps();
    const interval = setInterval(() => fetchOps(true), 20000);
    return () => clearInterval(interval);
  }, [fetchOps]);

  const viewEnd = useMemo(() => {
    const d = new Date(viewStart);
    d.setDate(d.getDate() + dayCount);
    return d;
  }, [viewStart, dayCount]);

  const totalMs = viewEnd.getTime() - viewStart.getTime();

  const days = useMemo(
    () =>
      Array.from({ length: dayCount }, (_, i) => {
        const d = new Date(viewStart);
        d.setDate(d.getDate() + i);
        return d;
      }),
    [viewStart, dayCount],
  );

  const todayKey = startOfDay(new Date()).toDateString();

  // Operations inside the timeline window with a start/end.
  const scheduledOps = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return operations.filter((op) => {
      if (!op.scheduledStart || !op.scheduledEnd) return false;
      const start = new Date(op.scheduledStart).getTime();
      const end = new Date(op.scheduledEnd).getTime();
      if (end < viewStart.getTime() || start > viewEnd.getTime()) return false;
      if (!q) return true;
      return [op.orderNumber, op.orderTitle, op.operationName, op.machineCode]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [operations, viewStart, viewEnd, searchQuery]);

  // Build rows depending on mode.
  const rows = useMemo(() => {
    const map = new Map<string, { key: string; title: string; subtitle: string; ops: any[]; earliest: number }>();
    for (const op of scheduledOps) {
      const key = mode === "order" ? `order-${op.orderId}` : `machine-${op.machineId ?? "none"}`;
      const start = new Date(op.scheduledStart).getTime();
      let row = map.get(key);
      if (!row) {
        row =
          mode === "order"
            ? { key, title: op.orderNumber ?? "Order", subtitle: op.orderTitle ?? "", ops: [], earliest: start }
            : {
                key,
                title: op.machineCode ?? "Unassigned",
                subtitle: machines.find((m) => String(m.id) === String(op.machineId))?.name ?? "No station",
                ops: [],
                earliest: start,
              };
        map.set(key, row);
      }
      row.ops.push(op);
      if (start < row.earliest) row.earliest = start;
    }
    return Array.from(map.values()).sort((a, b) => a.earliest - b.earliest);
  }, [scheduledOps, mode, machines]);

  const totalEstimatedHours = useMemo(
    () => Math.round((scheduledOps.reduce((s, o) => s + (o.estimatedMinutes || 0), 0) / 60) * 10) / 10,
    [scheduledOps],
  );

  const shiftPeriod = (dir: number) => setViewStart((prev) => {
    const d = new Date(prev);
    d.setDate(d.getDate() + dir * dayCount);
    return d;
  });

  const nowPercent =
    Date.now() >= viewStart.getTime() && Date.now() <= viewEnd.getTime()
      ? ((Date.now() - viewStart.getTime()) / totalMs) * 100
      : null;

  const goToToday = () => setViewStart(startOfDay(new Date()));
  const isTodayInView = viewStart.getTime() <= Date.now() && viewEnd.getTime() >= Date.now() && viewStart.toDateString() === startOfDay(new Date()).toDateString();

  return (
    <div className="mx-auto max-w-[1600px] space-y-5 p-4 sm:p-6">
      {/* Header / Controls */}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-amber-400">
            <GanttChartSquare className="h-4 w-4" /> Production Gantt chart
          </div>
          <h1 className="text-xl font-black tracking-tight text-white sm:text-2xl">Order & machine timeline</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
            Every scheduled operation plotted across a {dayCount}-day window. Switch between the per-order flow view and per-machine lane view. Click any bar to open its workflow.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Bars shown</div>
            <div className="font-mono text-lg font-black text-white">{scheduledOps.length}</div>
          </div>
          <div className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Est. hours</div>
            <div className="font-mono text-lg font-black text-amber-400">{totalEstimatedHours}</div>
          </div>
          <button
            onClick={() => fetchOps(true)}
            aria-label="Refresh"
            title="Refresh"
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-700 bg-slate-800 text-slate-300 transition hover:border-amber-500/50 hover:text-white"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin text-amber-400" : ""}`} />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        {/* Mode toggle */}
        <div className="flex items-center rounded-xl border border-slate-800 bg-slate-950 p-1">
          <button
            onClick={() => setMode("order")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${mode === "order" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-white"}`}
          >
            <ClipboardList className="h-3.5 w-3.5" /> By Order flow
          </button>
          <button
            onClick={() => setMode("machine")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${mode === "machine" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-white"}`}
          >
            <Cpu className="h-3.5 w-3.5" /> By Machine lane
          </button>
        </div>

        {/* Week navigation */}
        <div className="flex items-center gap-2">
          <button onClick={() => shiftPeriod(-1)} aria-label="Previous" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 transition hover:text-white">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-center text-xs font-bold text-white">
            {days[0].toLocaleDateString(undefined, { month: "short", day: "numeric" })} – {days[days.length - 1].toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          </div>
          <button onClick={() => shiftPeriod(1)} aria-label="Next" className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-300 transition hover:text-white">
            <ChevronRight className="h-4 w-4" />
          </button>
          {!isTodayInView && (
            <button onClick={goToToday} className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[11px] font-bold text-slate-300 transition hover:bg-slate-700">
              Today
            </button>
          )}
          <div className="ml-1 flex items-center rounded-lg border border-slate-700 bg-slate-950 p-0.5">
            <button onClick={() => setDayCount((d) => Math.max(4, d - 3))} aria-label="Zoom in" className="rounded-md p-1.5 text-slate-300 hover:text-white">
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <span className="px-1 text-[10px] font-bold text-slate-400">{dayCount}d</span>
            <button onClick={() => setDayCount((d) => Math.min(21, d + 3))} aria-label="Zoom out" className="rounded-md p-1.5 text-slate-300 hover:text-white">
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs font-bold text-rose-200">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[11px] text-slate-400">
        {Object.entries(STATUS_COLORS).map(([status, c]) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className={`h-3 w-3 rounded ${c.dot}`} />
            <span className="font-semibold">{status}</span>
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-4 w-px bg-emerald-400" /> Current time
        </span>
      </div>

      {/* Gantt body */}
      {loading ? (
        <div className="space-y-2 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-800/50" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-16 text-center">
          <CalendarDays className="mx-auto mb-3 h-14 w-14 stroke-[1.5] text-slate-600" />
          <h3 className="text-lg font-bold text-white">Nothing scheduled in this window</h3>
          <p className="mt-1 text-xs text-slate-400">
            No operations fall between {days[0].toLocaleDateString()} and {days[days.length - 1].toLocaleDateString()}.
            Schedule slots in the Dispatch Schedule tab, or move to another period.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-800/80 bg-slate-900/90 shadow-sm">
          <div className="min-w-[860px]">
            {/* Day header row */}
            <div className="flex border-b border-slate-800 bg-slate-950/60">
              <div className={`${LABEL_WIDTH} flex-shrink-0 border-r border-slate-800 px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-slate-500`}>
                {mode === "order" ? "Orders" : "Machines"}
              </div>
              <div className="relative flex flex-1">
                {days.map((d) => {
                  const isToday = d.toDateString() === todayKey;
                  return (
                    <div
                      key={d.toISOString()}
                      className={`flex-1 border-l border-slate-800/70 px-2 py-2 text-[10px] font-black uppercase tracking-wide ${isToday ? "text-amber-400" : "text-slate-500"}`}
                    >
                      <div className={isToday ? "text-amber-400" : "text-slate-400"}>{fmtDayLabel(d)}</div>
                    </div>
                  );
                })}
                {nowPercent !== null && (
                  <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-emerald-400" style={{ left: `${nowPercent}%` }} />
                )}
              </div>
            </div>

            {/* Rows */}
            <div>
              {rows.map((row) => (
                <div key={row.key} className="flex border-b border-slate-800/70 last:border-b-0 hover:bg-slate-800/20">
                  {/* Label */}
                  <div className={`${LABEL_WIDTH} flex-shrink-0 border-r border-slate-800/70 px-3 py-2`}>
                    <div className="truncate font-mono text-xs font-black text-amber-400">{row.title}</div>
                    <div className="truncate text-[10px] text-slate-400">{row.subtitle}</div>
                  </div>

                  {/* Timeline cell */}
                  <div className="relative h-14 flex-1">
                    {/* Day gridlines */}
                    <div className="absolute inset-0 flex">
                      {days.map((d) => (
                        <div key={d.toISOString()} className={`flex-1 border-l border-slate-800/40 ${d.toDateString() === todayKey ? "bg-amber-500/5" : ""}`} />
                      ))}
                    </div>

                    {/* Today marker */}
                    {nowPercent !== null && (
                      <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-emerald-400/80" style={{ left: `${nowPercent}%` }} />
                    )}

                    {/* Bars */}
                    {row.ops.map((op) => {
                      const s = new Date(op.scheduledStart).getTime();
                      const e = new Date(op.scheduledEnd).getTime();
                      const left = clamp(((s - viewStart.getTime()) / totalMs) * 100, 0, 100);
                      const width = clamp(((Math.min(e, viewEnd.getTime()) - Math.max(s, viewStart.getTime())) / totalMs) * 100, 1.5, 100 - left);
                      const c = colorFor(op.status);
                      const isHover = hoverBar === op.id;
                      return (
                        <button
                          key={op.id}
                          onClick={() => onSelectOrder(op.orderId)}
                          onMouseEnter={() => setHoverBar(op.id)}
                          onMouseLeave={() => setHoverBar(null)}
                          title={`${op.orderNumber} · ${op.operationName}\n${new Date(op.scheduledStart).toLocaleString()} → ${new Date(op.scheduledEnd).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}\n${op.machineCode ?? "Unassigned"} · ${op.status}`}
                          className={`absolute top-2 z-10 flex h-10 items-center overflow-hidden rounded-lg border px-2 text-left shadow-md transition-all hover:z-30 hover:ring-2 hover:ring-white/40 ${c.bar} ${op.status === "Completed" ? "" : ""}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                        >
                          <span className="truncate text-[10px] font-black text-white drop-shadow">
                            {width > 6 ? op.operationName : op.orderNumber}
                          </span>
                          {isHover && (
                            <span className="pointer-events-none absolute bottom-full left-0 z-40 mb-1 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[10px] font-bold text-slate-100 shadow-xl">
                              <span className="font-mono text-amber-400">{op.orderNumber}</span> · {op.operationName}
                              <span className="mt-0.5 block text-slate-400">
                                <Clock className="mr-1 inline h-3 w-3" />
                                {new Date(op.scheduledStart).toLocaleDateString([], { month: "short", day: "numeric" })} {fmtTime(op.scheduledStart)}–{fmtTime(op.scheduledEnd)}
                              </span>
                              <span className="block text-slate-500">
                                {op.machineCode ?? "Unassigned"} · {op.estimatedMinutes}m · {op.status}
                              </span>
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Footer hint */}
      <div className="flex items-center gap-2 px-1 text-[11px] text-slate-500">
        <Layers className="h-3.5 w-3.5" />
        <span>
          Showing {rows.length} {mode === "order" ? "orders" : "machine lanes"} across {dayCount} days.{" "}
          {mode === "order" ? "Each lane traces one order through its stations over time." : "Each lane shows the workload of one machine."}
        </span>
      </div>
    </div>
  );
}


