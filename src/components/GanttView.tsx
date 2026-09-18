"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Clock,
  Flag,
  GanttChartSquare,
  LayoutDashboard,
  Package,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  HEALTH_COLUMNS,
  assignLanes,
  buildDays,
  computeTimelineWindow,
  daysToDue,
  endOfDayMs,
  healthBucket,
  isDeliveredOrder,
  isOrderOpen,
  maxLanes,
  nextOpenStep,
  orderSpan,
  recentlyDelivered,
  scheduleCrossesDue,
  startOfDayMs,
  stepWindow,
  unscheduledStepCount,
  type GanttOrder,
  type GanttStep,
  type HealthBucket,
  type StepWindow,
  type TimelineWindow,
} from "@/lib/ganttModel";

interface GanttViewProps {
  machines?: any[];
  onSelectOrder: (orderId: number) => void;
  searchQuery?: string;
}

const LABEL_WIDTH = 224;
const ORDER_ROW_H = 56;
const BATCH_ROW_H = 36;
const MIN_DAY_W = 26;
const MAX_DAY_W = 64;
const MAX_LANES = 8;

// ---- colour language -------------------------------------------------------

const STEP_COLORS: Record<string, { bar: string; dot: string; label: string }> = {
  "In Progress": { bar: "bg-gradient-to-r from-amber-500 to-amber-400 border-amber-300/70", dot: "bg-amber-400", label: "In Progress" },
  Ready: { bar: "bg-gradient-to-r from-blue-600 to-blue-400 border-blue-300/70", dot: "bg-blue-400", label: "Ready" },
  Pending: { bar: "bg-gradient-to-r from-slate-600 to-slate-500 border-slate-400/70", dot: "bg-slate-400", label: "Pending" },
  Completed: { bar: "bg-gradient-to-r from-emerald-700 to-emerald-600 border-emerald-400/70", dot: "bg-emerald-400", label: "Completed" },
  "Rejected/Rework": { bar: "bg-gradient-to-r from-rose-600 to-rose-500 border-rose-300/70", dot: "bg-rose-400", label: "Rejected/Rework" },
};

function stepColor(status: string) {
  return STEP_COLORS[status] ?? STEP_COLORS.Pending;
}

const CANDLE_COLORS: Record<string, { border: string; bg: string; badge: string }> = {
  Pending: { border: "border-slate-500/70", bg: "bg-slate-500/15", badge: "bg-slate-700/60 text-slate-300" },
  "In Production": { border: "border-amber-500/70", bg: "bg-amber-500/15", badge: "bg-amber-500/20 text-amber-300" },
  "Quality Review": { border: "border-violet-500/70", bg: "bg-violet-500/15", badge: "bg-violet-500/20 text-violet-300" },
  Completed: { border: "border-emerald-500/70", bg: "bg-emerald-500/15", badge: "bg-emerald-500/20 text-emerald-300" },
  "On Hold": { border: "border-rose-400/60", bg: "bg-rose-500/10", badge: "bg-rose-500/20 text-rose-300" },
  Delivered: { border: "border-teal-500/70", bg: "bg-teal-500/15", badge: "bg-teal-500/20 text-teal-300" },
};

function candleColor(status: string) {
  return CANDLE_COLORS[status] ?? CANDLE_COLORS.Pending;
}

const HEALTH_META: Record<HealthBucket, { border: string; header: string; chip: string; dot: string }> = {
  "on-track": { border: "border-t-emerald-500", header: "text-emerald-300", chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30", dot: "bg-emerald-400" },
  "at-risk": { border: "border-t-amber-500", header: "text-amber-300", chip: "bg-amber-500/15 text-amber-300 border-amber-500/30", dot: "bg-amber-400" },
  overdue: { border: "border-t-rose-500", header: "text-rose-300", chip: "bg-rose-500/15 text-rose-300 border-rose-500/30", dot: "bg-rose-400" },
  ready: { border: "border-t-sky-500", header: "text-sky-300", chip: "bg-sky-500/15 text-sky-300 border border-sky-500/30", dot: "bg-sky-400" },
  delivered: { border: "border-t-teal-500", header: "text-teal-300", chip: "bg-teal-500/15 text-teal-300 border-teal-500/30", dot: "bg-teal-400" },
};

const STAGE_LABELS: Record<string, string> = {
  cleaning: "Cleaning",
  qc: "QC",
  packing: "Packing",
  awaiting_delivery: "Awaiting delivery",
  delivered: "Delivered",
};

function priorityChip(priority: string) {
  if (priority === "Urgent") return "bg-rose-500/20 text-rose-300 border-rose-500/30";
  if (priority === "High") return "bg-amber-500/20 text-amber-300 border-amber-500/30";
  return "bg-slate-800 text-slate-400 border-slate-700";
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function fmtDay(d: Date) {
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

function fmtTime(value: string | null) {
  if (!value) return "";
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface PositionedStep {
  step: GanttStep;
  window: StepWindow | null;
  lane: number;
}

interface BatchRow {
  key: string;
  batchNumber: number | null;
  name: string;
  placed: PositionedStep[];
  lanes: number[];
  laneCount: number;
  done: number;
}

interface OrderRow {
  order: GanttOrder;
  span: ReturnType<typeof orderSpan>;
  placed: PositionedStep[];
  lanes: number[];
  laneCount: number;
  unscheduled: GanttStep[];
  batches: BatchRow[];
}

// ============================================================================

export default function GanttView({ machines = [], onSelectOrder, searchQuery = "" }: GanttViewProps) {
  const [orders, setOrders] = useState<GanttOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState<"timeline" | "health">("timeline");
  const [rangePreset, setRangePreset] = useState<"auto" | "7d" | "30d" | "month">("auto");
  const [dayWidth, setDayWidth] = useState(38);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [hoverBar, setHoverBar] = useState<string | null>(null);

  const fetchModel = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const res = await fetch("/api/gantt", { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Server returned status ${res.status}. Please check your login session.`);
      }
      const payload = await res.json();
      setOrders(Array.isArray(payload?.orders) ? payload.orders : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load the order timeline.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchModel();
    const interval = setInterval(() => fetchModel(true), 15000);
    return () => clearInterval(interval);
  }, [fetchModel]);

  const now = useMemo(() => Date.now(), [orders]);
  const todayKey = startOfDayMs(now);

  const machineName = useCallback(
    (code: string | null) => (code ? machines.find((m: any) => m.code === code)?.name ?? null : null),
    [machines],
  );

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) =>
      [o.orderNumber, o.title, o.customerLabel, o.projectType, o.status]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [orders, searchQuery]);

  // ---- timeline window -----------------------------------------------------

  const window: TimelineWindow = useMemo(() => {
    if (rangePreset === "auto") return computeTimelineWindow(filteredOrders, now);
    const today = startOfDayMs(now);
    if (rangePreset === "7d") return { startMs: today - 86_400_000, endMs: today + 6 * 86_400_000 };
    if (rangePreset === "30d") return { startMs: today - 4 * 86_400_000, endMs: today + 25 * 86_400_000 };
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getTime() + 86_400_000 - 1;
    return { startMs: d.getTime(), endMs: last };
  }, [filteredOrders, rangePreset, now]);

  const days = useMemo(() => buildDays(window), [window]);
  const totalMs = window.endMs - window.startMs + 1;
  const pct = useCallback(
    (ms: number) => clamp(((ms - window.startMs) / totalMs) * 100, 0, 100),
    [window, totalMs],
  );

  const nowPct =
    now >= window.startMs && now <= window.endMs ? ((now - window.startMs) / totalMs) * 100 : null;

  // ---- row model -------------------------------------------------------------

  const rows: OrderRow[] = useMemo(() => {
    return filteredOrders.map((order) => {
      const sorted = order.steps
        .slice()
        .sort((a, b) => {
          const wa = stepWindow(a);
          const wb = stepWindow(b);
          const sa = wa ? wa.startMs : Number.MAX_SAFE_INTEGER;
          const sb = wb ? wb.startMs : Number.MAX_SAFE_INTEGER;
          return sa - sb || a.stepOrder - b.stepOrder || a.id - b.id;
        });
      const windows = sorted.map((s) => stepWindow(s));
      const lanes = assignLanes(windows);
      const placed: PositionedStep[] = sorted.map((step, i) => ({
        step,
        window: windows[i],
        lane: Math.min(lanes[i], MAX_LANES - 1),
      }));
      const unscheduled = placed
        .filter((p) => !p.window && p.step.status !== "Completed")
        .map((p) => p.step);

      const byBatch = new Map<string, GanttStep[]>();
      for (const p of placed) {
        if (p.step.batchId == null) continue;
        const key = `batch-${p.step.batchId}`;
        const list = byBatch.get(key) ?? [];
        list.push(p.step);
        byBatch.set(key, list);
      }
      const batches: BatchRow[] = Array.from(byBatch.entries())
        .map(([key, steps]) => {
          const sorted = steps.slice().sort((a, b) => a.stepOrder - b.stepOrder || a.id - b.id);
          const wins = sorted.map((s) => stepWindow(s));
          const lns = assignLanes(wins);
          return {
            key,
            batchNumber: sorted[0]?.batchNumber ?? null,
            name: sorted[0]?.batchName ?? "Material batch",
            placed: sorted.map((step, i) => ({ step, window: wins[i], lane: Math.min(lns[i], 3) })),
            lanes: lns,
            laneCount: Math.min(maxLanes(lns), 4) || 1,
            done: sorted.filter((s) => s.status === "Completed").length,
          };
        })
        .sort((a, b) => (a.batchNumber ?? 0) - (b.batchNumber ?? 0));

      return {
        order,
        span: orderSpan(order),
        placed,
        lanes,
        laneCount: Math.min(maxLanes(lanes), MAX_LANES) || 1,
        unscheduled,
        batches,
      };
    });
  }, [filteredOrders]);

  const stats = useMemo(() => {
    const active = filteredOrders.filter((o) => isOrderOpen(o));
    const overdue = active.filter((o) => healthBucket(o, now) === "overdue").length;
    const atRisk = active.filter((o) => healthBucket(o, now) === "at-risk").length;
    const unscheduled = filteredOrders.reduce((s, o) => s + unscheduledStepCount(o), 0);
    return { orders: filteredOrders.length, overdue, atRisk, unscheduled };
  }, [filteredOrders, now]);

  const toggleExpanded = (orderId: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(orderId)) next.delete(orderId);
      else next.add(orderId);
      return next;
    });

  // ---- health board ----------------------------------------------------------

  const healthColumns = useMemo(() => {
    const open = filteredOrders.filter((o) => o.status !== "Cancelled");
    return HEALTH_COLUMNS.map((col) => {
      const list = open
        .filter((o) => healthBucket(o, now) === col.id)
        .filter((o) => (col.id === "delivered" ? recentlyDelivered(o, now, 14) : true))
        .sort((a, b) => daysToDue(a, now) - daysToDue(b, now));
      return { ...col, orders: list };
    });
  }, [filteredOrders, now]);

  // ---- render ----------------------------------------------------------------

  return (
    <div className="mx-auto max-w-[1700px] space-y-5 p-4 sm:p-6">
      {/* Header / Controls */}
      <div className="flex flex-col gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-amber-400">
            <GanttChartSquare className="h-4 w-4" /> Order timeline & delivery health
          </div>
          <h1 className="text-xl font-black tracking-tight text-white sm:text-2xl">
            Daily Gantt — issue date to due date
          </h1>
          <p className="mt-1 max-w-3xl text-xs leading-relaxed text-slate-400">
            Every order is drawn as a candle from its issue date to the due date (or the actual delivery date).
            Production steps sit on their real scheduled or actual dates, coloured by step status. Expand an order
            to follow each material batch on its own lane.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-right">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Orders</div>
            <div className="font-mono text-lg font-black text-white">{stats.orders}</div>
          </div>
          <div className={`rounded-xl border bg-slate-950 px-3 py-2 text-right ${stats.overdue > 0 ? "border-rose-500/50" : "border-slate-700"}`}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Overdue</div>
            <div className={`font-mono text-lg font-black ${stats.overdue > 0 ? "text-rose-400" : "text-white"}`}>{stats.overdue}</div>
          </div>
          <div className={`rounded-xl border bg-slate-950 px-3 py-2 text-right ${stats.unscheduled > 0 ? "border-amber-500/40" : "border-slate-700"}`}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Unscheduled</div>
            <div className={`font-mono text-lg font-black ${stats.unscheduled > 0 ? "text-amber-400" : "text-white"}`}>{stats.unscheduled}</div>
          </div>
          <button
            onClick={() => fetchModel(true)}
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
        {/* View toggle */}
        <div className="flex items-center rounded-xl border border-slate-800 bg-slate-950 p-1">
          <button
            onClick={() => setView("timeline")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${view === "timeline" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-white"}`}
          >
            <GanttChartSquare className="h-3.5 w-3.5" /> Daily Timeline
          </button>
          <button
            onClick={() => setView("health")}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${view === "health" ? "bg-amber-500 text-slate-950" : "text-slate-400 hover:text-white"}`}
          >
            <LayoutDashboard className="h-3.5 w-3.5" /> Deadline Health Board
          </button>
        </div>

        {view === "timeline" ? (
          <div className="flex flex-wrap items-center gap-2">
            {/* Range presets */}
            <div className="flex items-center rounded-lg border border-slate-700 bg-slate-950 p-0.5">
              {([
                ["auto", "Auto fit"],
                ["7d", "7 days"],
                ["30d", "30 days"],
                ["month", "This month"],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setRangePreset(id)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-bold transition ${rangePreset === id ? "bg-slate-700 text-white" : "text-slate-400 hover:text-white"}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* Zoom */}
            <div className="flex items-center rounded-lg border border-slate-700 bg-slate-950 p-0.5">
              <button
                onClick={() => setDayWidth((d) => Math.max(MIN_DAY_W, d - 6))}
                aria-label="Zoom in (wider days)"
                className="rounded-md p-1.5 text-slate-300 hover:text-white"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              <span className="px-1 font-mono text-[10px] font-bold text-slate-400">{dayWidth}px</span>
              <button
                onClick={() => setDayWidth((d) => Math.min(MAX_DAY_W, d + 6))}
                aria-label="Zoom out (narrower days)"
                className="rounded-md p-1.5 text-slate-300 hover:text-white"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
            </div>
            <span className="text-[11px] font-bold text-slate-500">
              {days.length} days · {fmtDay(new Date(days[0] ?? now))} – {fmtDay(new Date(days[days.length - 1] ?? now))}
            </span>
          </div>
        ) : (
          <span className="text-[11px] font-bold text-slate-500">
            Rules: overdue = past due with open work · at risk = due ≤ 7 days with &lt;50% progress or unscheduled steps
          </span>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-xs font-bold text-rose-200">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {loading ? (
        <div className="space-y-2 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-800/50" />
          ))}
        </div>
      ) : view === "timeline" ? (
        <Timeline
          rows={rows}
          days={days}
          totalMs={totalMs}
          pct={pct}
          nowPct={nowPct}
          todayKey={todayKey}
          dayWidth={dayWidth}
          expanded={expanded}
          onToggle={toggleExpanded}
          onSelect={onSelectOrder}
          hoverBar={hoverBar}
          setHoverBar={setHoverBar}
          machineName={machineName}
        />
      ) : (
        <HealthBoard columns={healthColumns} now={now} onSelect={onSelectOrder} machineName={machineName} />
      )}

      {/* Legend */}
      {view === "timeline" && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-[11px] text-slate-400">
          {Object.values(STEP_COLORS).map((c) => (
            <span key={c.label} className="flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded ${c.dot}`} />
              <span className="font-semibold">{c.label}</span>
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <Flag className="h-3.5 w-3.5 text-amber-400" /> Due date
          </span>
          <span className="flex items-center gap-1.5">
            <Flag className="h-3.5 w-3.5 text-rose-400" /> Overdue
          </span>
          <span className="flex items-center gap-1.5">
            <Flag className="h-3.5 w-3.5 text-teal-400" /> Delivered
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-4 w-px bg-emerald-400" /> Current time
          </span>
          <span className="flex items-center gap-1.5">
            <span className="rounded border border-dashed border-slate-500 px-1 text-[9px] font-bold text-slate-400">+N</span>
            Unscheduled steps
          </span>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// Timeline
// ============================================================================

interface TimelineProps {
  rows: OrderRow[];
  days: number[];
  totalMs: number;
  pct: (ms: number) => number;
  nowPct: number | null;
  todayKey: number;
  dayWidth: number;
  expanded: Set<number>;
  onToggle: (orderId: number) => void;
  onSelect: (orderId: number) => void;
  hoverBar: string | null;
  setHoverBar: (id: string | null) => void;
  machineName: (code: string | null) => string | null;
}

function Timeline({
  rows,
  days,
  totalMs,
  pct,
  nowPct,
  todayKey,
  dayWidth,
  expanded,
  onToggle,
  onSelect,
  hoverBar,
  setHoverBar,
  machineName,
}: TimelineProps) {
  const timelineW = days.length * dayWidth;

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-16 text-center">
        <CalendarDays className="mx-auto mb-3 h-14 w-14 stroke-[1.5] text-slate-600" />
        <h3 className="text-lg font-bold text-white">No orders in this timeline</h3>
        <p className="mt-1 text-xs text-slate-400">
          No active orders match the current search and range. Try the “Auto fit” range or clear the search.
        </p>
      </div>
    );
  }

  const dayGrid = (
    <div className="absolute inset-0 flex" style={{ width: timelineW }}>
      {days.map((d) => {
        const date = new Date(d);
        const isToday = d === todayKey;
        const weekend = date.getDay() === 0 || date.getDay() === 6;
        return (
          <div
            key={d}
            className={`flex-shrink-0 border-l border-slate-800/40 ${isToday ? "bg-amber-500/10" : weekend ? "bg-slate-800/20" : ""}`}
            style={{ width: dayWidth }}
          />
        );
      })}
    </div>
  );

  const todayLine = (className: string) =>
    nowPct !== null && (
      <div
        className={`pointer-events-none absolute inset-y-0 z-20 w-px ${className}`}
        style={{ left: `${nowPct}%` }}
      />
    );

  return (
    <div className="max-h-[74vh] overflow-auto rounded-2xl border border-slate-800/80 bg-slate-900/90 shadow-sm">
      <div style={{ width: LABEL_WIDTH + timelineW }} className="min-w-full">
        {/* Day header */}
        <div className="sticky top-0 z-30 flex border-b border-slate-800 bg-slate-950/95 backdrop-blur">
          <div
            className="sticky left-0 z-40 flex-shrink-0 border-r border-slate-800 bg-slate-950 px-3 py-2.5 text-[10px] font-black uppercase tracking-wider text-slate-500"
            style={{ width: LABEL_WIDTH }}
          >
            Orders · step status
          </div>
          <div className="relative flex" style={{ width: timelineW }}>
            {days.map((d) => {
              const date = new Date(d);
              const isToday = d === todayKey;
              return (
                <div
                  key={d}
                  className={`flex-shrink-0 border-l border-slate-800/70 px-1 text-center text-[9px] font-black uppercase tracking-wide ${isToday ? "text-amber-400" : "text-slate-500"}`}
                  style={{ width: dayWidth }}
                  title={date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
                >
                  <div className="whitespace-nowrap overflow-hidden leading-tight">
                    {date.toLocaleDateString(undefined, { weekday: "short" })}
                    <div className="text-[10px] text-slate-300">{date.getDate()}</div>
                    {dayWidth >= 44 && <div className="text-[9px] text-slate-500">{date.toLocaleDateString(undefined, { month: "short" })}</div>}
                  </div>
                </div>
              );
            })}
            {nowPct !== null && (
              <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-emerald-400" style={{ left: `${nowPct}%` }} />
            )}
          </div>
        </div>

        {/* Rows */}
        {rows.map((row) => (
          <OrderTimelineRow
            key={row.order.id}
            row={row}
            timelineW={timelineW}
            totalMs={totalMs}
            pct={pct}
            dayGrid={dayGrid}
            todayLine={todayLine("bg-emerald-400/70")}
            isExpanded={expanded.has(row.order.id)}
            onToggle={() => onToggle(row.order.id)}
            onSelect={() => onSelect(row.order.id)}
            hoverBar={hoverBar}
            setHoverBar={setHoverBar}
            machineName={machineName}
          />
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// One order: candle row (+ optional expanded batch lanes)
// ============================================================================

function OrderTimelineRow({
  row,
  timelineW,
  totalMs,
  pct,
  dayGrid,
  todayLine,
  isExpanded,
  onToggle,
  onSelect,
  hoverBar,
  setHoverBar,
  machineName,
}: {
  row: OrderRow;
  timelineW: number;
  totalMs: number;
  pct: (ms: number) => number;
  dayGrid: React.ReactNode;
  todayLine: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  onSelect: () => void;
  hoverBar: string | null;
  setHoverBar: (id: string | null) => void;
  machineName: (code: string | null) => string | null;
}) {
  const { order, span, placed, laneCount, unscheduled, batches } = row;
  const open = isOrderOpen(order);
  const delivered = isDeliveredOrder(order);
  const overdue = open && endOfDayMs(order.dueDate) < startOfDayMs(Date.now());
  const color = candleColor(order.status);
  const dueInDays = daysToDue(order, Date.now());

  const left = pct(span.startMs);
  const width = clamp(((span.endMs - span.startMs + 1) / totalMs) * 100, 0.6, 100 - left);

  const duePos = pct(span.dueMs + 1);
  const deliveredPos = span.deliveredMs !== null ? pct(span.deliveredMs + 1) : null;

  // Lane geometry inside the candle
  const innerPad = 6;
  const avail = ORDER_ROW_H - innerPad * 2;
  const laneH = clamp(Math.floor(avail / laneCount), 5, 16);

  return (
    <div className="border-b border-slate-800/70 last:border-b-0">
      {/* Candle row */}
      <div className="flex hover:bg-slate-800/20" style={{ height: ORDER_ROW_H }}>
        {/* Label cell */}
        <div
          className="sticky left-0 z-20 flex flex-shrink-0 items-center gap-1.5 border-r border-slate-800/70 bg-slate-900/95 px-2.5 backdrop-blur"
          style={{ width: LABEL_WIDTH }}
        >
          {batches.length > 0 ? (
            <button
              onClick={onToggle}
              aria-label={isExpanded ? "Collapse batch lanes" : "Expand batch lanes"}
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-800 hover:text-amber-400"
            >
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="h-6 w-6 flex-shrink-0" />
          )}
          <button onClick={onSelect} className="min-w-0 flex-1 text-left">
            <div className="flex items-center gap-1.5">
              <span className="truncate font-mono text-xs font-black text-amber-400">{order.orderNumber}</span>
              {(order.priority === "Urgent" || order.priority === "High") && (
                <span className={`rounded border px-1 text-[8px] font-extrabold uppercase ${priorityChip(order.priority)}`}>{order.priority}</span>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className="truncate text-[10px] text-slate-400">{order.customerLabel || order.title}</span>
              <span className={`ml-auto flex-shrink-0 rounded px-1 py-px text-[8px] font-extrabold uppercase ${color.badge}`}>
                {order.status}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[9px] font-bold">
              <span className={overdue ? "text-rose-400" : dueInDays <= 7 ? "text-amber-400" : "text-slate-500"}>
                {overdue ? `Overdue ${Math.abs(dueInDays)}d` : `Due in ${dueInDays}d`}
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-slate-500">
                {order.completedSteps}/{order.totalSteps} steps
              </span>
              {unscheduled.length > 0 && (
                <span className="rounded border border-dashed border-amber-500/50 bg-amber-500/10 px-1 text-amber-300">
                  {unscheduled.length} unsched.
                </span>
              )}
            </div>
          </button>
        </div>

        {/* Timeline cell */}
        <div className="relative flex-1" style={{ width: timelineW }}>
          {dayGrid}
          {todayLine}

          {/* Candle */}
          <button
            onClick={onSelect}
            title={`${order.orderNumber} · ${order.title}\n${new Date(order.createdAt).toLocaleDateString()} → ${delivered ? (order.dispatch.deliveredAt ? new Date(order.dispatch.deliveredAt).toLocaleDateString() : "delivered") : new Date(order.dueDate).toLocaleDateString()}\n${order.status}`}
            className={`absolute inset-y-1 z-10 overflow-visible rounded-md border ${color.border} ${color.bg} transition hover:z-30 hover:ring-2 hover:ring-white/30 ${overdue ? "ring-1 ring-rose-500/60" : ""}`}
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            {/* Due-date tick (inside candle, at the due day end) */}
            {duePos >= left && duePos <= left + width && (
              <span
                className={`absolute inset-y-0 w-px ${overdue ? "bg-rose-400/80" : "bg-amber-400/70"}`}
                style={{ left: `${((duePos - left) / width) * 100}%` }}
              />
            )}
            {/* Delivered tick */}
            {deliveredPos !== null && deliveredPos >= left && deliveredPos <= left + width && (
              <span
                className="absolute inset-y-0 w-px bg-teal-400/90"
                style={{ left: `${((deliveredPos - left) / width) * 100}%` }}
              />
            )}

            {/* Step bars on true dates */}
            {placed
              .filter((p) => p.window)
              .map((p) => {
                const w = p.window as StepWindow;
                const barLeft = pct(w.startMs);
                const barWidth = clamp(((w.endMs - w.startMs + 1) / totalMs) * 100, 0.9, 100 - barLeft);
                // Relative to the candle; bars may overflow the right edge to
                // make "plan crosses due" visible instead of clipping it away.
                const relLeft = clamp(((barLeft - left) / Math.max(width, 0.001)) * 100, 0, 400);
                const relWidth = clamp((barWidth / Math.max(width, 0.001)) * 100, 1, 400);
                const c = stepColor(p.step.status);
                const key = `step-${p.step.id}`;
                const isHover = hoverBar === key;
                const barTop = innerPad + p.lane * laneH + (laneH - (laneH - 2)) / 2;
                return (
                  <span
                    key={p.step.id}
                    onMouseEnter={() => setHoverBar(key)}
                    onMouseLeave={() => setHoverBar(null)}
                    className={`absolute z-10 rounded-[3px] border shadow-sm ${c.bar} ${w.kind === "actual" ? "" : "opacity-90"}`}
                    style={{
                      left: `${relLeft}%`,
                      width: `${relWidth}%`,
                      top: barTop,
                      height: laneH - 2,
                    }}
                  >
                    {isHover && (
                      <span className="pointer-events-none absolute bottom-full left-0 z-50 mb-1 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[10px] font-bold text-slate-100 shadow-xl">
                        <span className="font-mono text-amber-400">{order.orderNumber}</span> · {p.step.operationName}
                        <span className="mt-0.5 block text-slate-400">
                          <Clock className="mr-1 inline h-3 w-3" />
                          {w.kind === "actual" ? "Actual" : "Scheduled"}{" "}
                          {new Date(w.startMs).toLocaleDateString([], { month: "short", day: "numeric" })} {fmtTime(p.step.startTime ?? p.step.scheduledStart)}
                          –{fmtTime(p.step.endTime ?? p.step.scheduledEnd)}
                        </span>
                        <span className="block text-slate-500">
                          {machineName(p.step.machineCode) ?? p.step.machineCode ?? "Unassigned"} · {p.step.estimatedMinutes ?? "?"}m · {p.step.status}
                        </span>
                      </span>
                    )}
                  </span>
                );
              })}

            {/* Unscheduled marker */}
            {unscheduled.length > 0 && (
              <span
                title={`Unscheduled steps:\n${unscheduled.map((s) => s.operationName).join("\n")}`}
                className="absolute right-0.5 top-0.5 z-20 rounded border border-dashed border-amber-400/70 bg-slate-950/80 px-1 text-[8px] font-black text-amber-300"
              >
                +{unscheduled.length}
              </span>
            )}
          </button>

          {/* Due / delivery flags riding on the timeline */}
          {duePos >= 0 && duePos <= 100 && (
            <span
              className={`pointer-events-none absolute z-20 -translate-x-1/2 ${overdue ? "text-rose-400" : delivered ? "text-teal-400" : "text-amber-400/90"}`}
              style={{ left: `${duePos}%`, top: 1 }}
              title={`Due ${new Date(order.dueDate).toLocaleDateString()}`}
            >
              <Flag className="h-3 w-3" />
            </span>
          )}
          {deliveredPos !== null && deliveredPos >= 0 && deliveredPos <= 100 && deliveredPos !== duePos && (
            <span
              className="pointer-events-none absolute z-20 -translate-x-1/2 text-teal-400"
              style={{ left: `${deliveredPos}%`, top: 1 }}
              title={`Delivered ${order.dispatch.deliveredAt ? new Date(order.dispatch.deliveredAt).toLocaleDateString() : ""}`}
            >
              <Flag className="h-3 w-3" />
            </span>
          )}
        </div>
      </div>

      {/* Expanded batch lanes */}
      {isExpanded &&
        batches.map((batch) => {
          const innerPadB = 4;
          const availB = BATCH_ROW_H - innerPadB * 2;
          const laneHB = clamp(Math.floor(availB / batch.laneCount), 4, 12);
          return (
            <div key={batch.key} className="flex border-b border-slate-800/40 bg-slate-950/40" style={{ height: BATCH_ROW_H }}>
              <div
                className="sticky left-0 z-20 flex flex-shrink-0 items-center gap-1.5 border-r border-slate-800/70 bg-slate-950 pl-9 pr-2 text-[10px] backdrop-blur"
                style={{ width: LABEL_WIDTH }}
              >
                <Package className="h-3 w-3 flex-shrink-0 text-sky-400" />
                <span className="font-black text-sky-300">Batch {batch.batchNumber ?? ""}</span>
                <span className="truncate text-slate-400">{batch.name}</span>
                <span className="ml-auto flex-shrink-0 font-bold text-slate-500">
                  {batch.done}/{batch.placed.length} done
                </span>
              </div>
              <div className="relative flex-1" style={{ width: timelineW }}>
                {dayGrid}
                {todayLine}
                {batch.placed
                  .filter((p) => p.window)
                  .map((p) => {
                    const w = p.window as StepWindow;
                    const barLeft = pct(w.startMs);
                    const barWidth = clamp(((w.endMs - w.startMs + 1) / totalMs) * 100, 0.9, 100 - barLeft);
                    const c = stepColor(p.step.status);
                    const key = `batch-${batch.key}-${p.step.id}`;
                    const isHover = hoverBar === key;
                    return (
                      <span
                        key={p.step.id}
                        onMouseEnter={() => setHoverBar(key)}
                        onMouseLeave={() => setHoverBar(null)}
                        className={`absolute z-10 rounded-[3px] border shadow-sm ${c.bar}`}
                        style={{
                          left: `${barLeft}%`,
                          width: `${barWidth}%`,
                          top: innerPadB + p.lane * laneHB + 1,
                          height: laneHB - 2,
                        }}
                      >
                        {isHover && (
                          <span className="pointer-events-none absolute bottom-full left-0 z-50 mb-1 whitespace-nowrap rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[10px] font-bold text-slate-100 shadow-xl">
                            <span className="font-mono text-amber-400">{order.orderNumber}</span> · {batch.name}
                            <span className="block text-slate-400">{p.step.operationName}</span>
                            <span className="block text-slate-500">
                              {w.kind === "actual" ? "Actual" : "Scheduled"} {new Date(w.startMs).toLocaleDateString([], { month: "short", day: "numeric" })} · {machineName(p.step.machineCode) ?? p.step.machineCode ?? "Unassigned"} · {p.step.status}
                            </span>
                          </span>
                        )}
                      </span>
                    );
                  })}
              </div>
            </div>
          );
        })}
    </div>
  );
}

// ============================================================================
// Deadline Health Board
// ============================================================================

function HealthBoard({
  columns,
  now,
  onSelect,
  machineName,
}: {
  columns: ({ id: HealthBucket; title: string; orders: GanttOrder[] })[];
  now: number;
  onSelect: (orderId: number) => void;
  machineName: (code: string | null) => string | null;
}) {
  if (columns.every((c) => c.orders.length === 0)) {
    return (
      <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-16 text-center">
        <LayoutDashboard className="mx-auto mb-3 h-14 w-14 stroke-[1.5] text-slate-600" />
        <h3 className="text-lg font-bold text-white">Nothing to follow right now</h3>
        <p className="mt-1 text-xs text-slate-400">No active or recently delivered orders match the current search.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
      {columns.map((col) => {
        const meta = HEALTH_META[col.id];
        return (
          <div key={col.id} className={`flex flex-col rounded-2xl border border-slate-800/80 border-t-2 bg-slate-950/60 p-3 ${meta.border}`}>
            <div className="mb-3 flex items-center justify-between pb-2">
              <span className={`text-xs font-extrabold uppercase tracking-wide ${meta.header}`}>
                {col.title}
              </span>
              <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-xs font-bold text-slate-200">{col.orders.length}</span>
            </div>
            <div className="max-h-[62vh] space-y-2.5 overflow-y-auto pr-1">
              {col.orders.map((order) => (
                <HealthCard key={order.id} order={order} now={now} bucket={col.id} onSelect={() => onSelect(order.id)} machineName={machineName} />
              ))}
              {col.orders.length === 0 && (
                <div className="py-8 text-center text-[11px] font-medium italic text-slate-600">None</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function HealthCard({
  order,
  now,
  bucket,
  onSelect,
  machineName,
}: {
  order: GanttOrder;
  now: number;
  bucket: HealthBucket;
  onSelect: () => void;
  machineName: (code: string | null) => string | null;
}) {
  const meta = HEALTH_META[bucket];
  const dueInDays = daysToDue(order, now);
  const overdue = dueInDays < 0 && !isDeliveredOrder(order);
  const next = nextOpenStep(order);
  const nextWindow = next ? stepWindow(next) : null;
  const unscheduled = unscheduledStepCount(order);
  const crosses = scheduleCrossesDue(order);
  const delivered = isDeliveredOrder(order);
  const color = candleColor(order.status);

  const dueChip = delivered
    ? `Delivered ${order.dispatch.deliveredAt ? new Date(order.dispatch.deliveredAt).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}`
    : overdue
      ? `${Math.abs(dueInDays)}d late`
      : `D-${dueInDays}`;

  return (
    <button
      onClick={onSelect}
      className="group w-full rounded-xl border border-slate-800 bg-slate-900 p-3 text-left shadow-sm transition hover:border-amber-500/50 hover:bg-slate-800"
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-black text-amber-400">{order.orderNumber}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${priorityChip(order.priority)}`}>{order.priority}</span>
      </div>
      <h4 className="mb-1 line-clamp-2 text-xs font-bold text-white group-hover:text-amber-300">{order.title}</h4>
      <div className="mb-2 truncate text-[10px] text-slate-400">{order.customerLabel || order.projectType || ""}</div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-extrabold ${overdue ? "border-rose-500/40 bg-rose-500/15 text-rose-300" : delivered ? "border-teal-500/40 bg-teal-500/15 text-teal-300" : dueInDays <= 7 ? "border-amber-500/40 bg-amber-500/15 text-amber-300" : "border-slate-700 bg-slate-800 text-slate-300"}`}>
          <CalendarDays className="mr-1 inline h-2.5 w-2.5" />
          {dueChip}
        </span>
        <span className={`rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${color.badge}`}>{order.status}</span>
      </div>

      {/* Progress */}
      <div className="mb-1 flex items-center justify-between text-[9px] font-bold text-slate-400">
        <span>
          {order.completedSteps} of {order.totalSteps} steps
        </span>
        <span>{order.progressPercent || 0}%</span>
      </div>
      <div className="mb-2 h-1.5 overflow-hidden rounded-full border border-slate-800 bg-slate-950">
        <div
          className={`h-full rounded-full ${order.progressPercent === 100 || delivered ? "bg-emerald-500" : "bg-gradient-to-r from-amber-600 to-amber-400"}`}
          style={{ width: `${clamp(order.progressPercent || 0, 0, 100)}%` }}
        />
      </div>

      {/* Next step */}
      {next ? (
        <div className="mb-2 rounded-lg border border-slate-800 bg-slate-950/70 p-2 text-[10px]">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-bold text-slate-200">{next.operationName}</span>
            <span className="flex-shrink-0 text-slate-500">{machineName(next.machineCode) ?? next.machineCode ?? "Unassigned"}</span>
          </div>
          <div className="mt-0.5 flex items-center justify-between text-[9px]">
            <span className="text-slate-500">Next step</span>
            {nextWindow ? (
              <span className="font-bold text-sky-300">
                {new Date(nextWindow.startMs).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            ) : (
              <span className="font-bold text-amber-400">unscheduled</span>
            )}
          </div>
        </div>
      ) : (
        <div className="mb-2 rounded-lg border border-slate-800 bg-slate-950/70 p-2 text-[10px] font-bold text-emerald-300">
          All steps complete
        </div>
      )}

      {/* Dispatch + warnings */}
      <div className="flex flex-wrap items-center gap-1.5">
        {order.dispatch.totalBatches > 0 && order.dispatch.stage && (
          <span className={`rounded border px-1.5 py-0.5 text-[9px] font-extrabold ${meta.chip}`}>
            {STAGE_LABELS[order.dispatch.stage] ?? order.dispatch.stage}
            {order.dispatch.totalBatches > 1 ? ` ${order.dispatch.deliveredCount}/${order.dispatch.totalBatches}` : ""}
            {order.dispatch.mixed ? " · mixed" : ""}
          </span>
        )}
        {crosses && (
          <span className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-extrabold text-rose-300">
            plan crosses due
          </span>
        )}
        {unscheduled > 0 && (
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-extrabold text-amber-300">
            {unscheduled} unscheduled
          </span>
        )}
        {bucket === "ready" && overdue && (
          <span className="rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[9px] font-extrabold text-rose-300">
            dispatch past due
          </span>
        )}
      </div>
    </button>
  );
}
