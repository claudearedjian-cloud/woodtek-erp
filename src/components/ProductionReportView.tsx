"use client";

import React, { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, BarChart3, CheckCircle2, RefreshCw, Timer } from "lucide-react";

const RANGES = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "week", label: "This week" },
  { id: "days7", label: "Last 7 days" },
  { id: "month", label: "This month" },
] as const;

type RangeId = (typeof RANGES)[number]["id"];

interface MachineStats {
  machineId: number;
  code: string;
  name: string;
  category: string;
  status: string;
  completed: number;
  actualMinutes: number;
  plannedMinutes: number;
  started: number;
  onTimeStarts: number;
  inFlight: number;
  overdue: number;
  avgActualMinutes: number | null;
  avgEstimatedMinutes: number | null;
}

interface OperatorStats {
  operatorId: number;
  name: string;
  completed: number;
  actualMinutes: number;
  started: number;
  onTimeStarts: number;
}

interface ReportData {
  range: RangeId;
  label: string;
  from: string;
  to: string;
  kpis: {
    completed: number;
    inProgress: number;
    started: number;
    actualMinutes: number;
    plannedMinutes: number;
    planCoverage: number | null;
    onTimeStarts: number;
    onTimeEligible: number;
    onTimeRate: number | null;
    overdue: number;
  };
  machines: MachineStats[];
  operators: OperatorStats[];
}

const hours = (minutes: number) => `${Math.round((minutes / 60) * 10) / 10}h`;
const pct = (value: number | null) => (value == null ? "—" : `${Math.round(value * 100)}%`);

export default function ProductionReportView({ currentUser }: { currentUser: any }) {
  const [range, setRange] = useState<RangeId>("today");
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/production-report?range=${range}`, { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Failed to load the production report.");
      setData(body);
      setError("");
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the production report.");
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    setLoading(true);
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const kpis = data?.kpis;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black text-white tracking-tight">Production Report</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Jobs completed, on-time starts and actual vs planned hours per machine.
            {updatedAt ? ` Updated ${updatedAt.toLocaleTimeString()}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-xl border border-slate-800 bg-slate-950 p-1">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                  range === r.id ? "bg-slate-800 text-amber-400" : "text-slate-400 hover:text-white"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={load}
            title="Refresh now"
            className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-slate-400 hover:text-white"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-900/60 bg-rose-950/40 px-4 py-3 text-xs font-bold text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {!data && !error ? (
        <div className="h-80 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20 animate-pulse" />
      ) : data ? (
        <>
          {/* ---- KPI row ---- */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiCard icon={CheckCircle2} tint="text-emerald-400 bg-emerald-500/10"
              label="Completed" value={String(kpis!.completed)}
              hint={`${data.label} · ${kpis!.started} started`} />
            <KpiCard icon={Activity} tint="text-sky-400 bg-sky-500/10"
              label="In progress" value={String(kpis!.inProgress)} hint="right now" />
            <KpiCard icon={Timer} tint="text-amber-400 bg-amber-500/10"
              label="Worked / planned"
              value={`${hours(kpis!.actualMinutes)} / ${hours(kpis!.plannedMinutes)}`}
              hint={`plan coverage ${pct(kpis!.planCoverage)}`} />
            <KpiCard icon={CheckCircle2} tint="text-violet-400 bg-violet-500/10"
              label="On-time starts"
              value={kpis!.onTimeEligible > 0 ? `${kpis!.onTimeStarts}/${kpis!.onTimeEligible}` : "—"}
              hint={pct(kpis!.onTimeRate) + " within 15 min"} />
            <KpiCard icon={AlertTriangle} tint={kpis!.overdue > 0 ? "text-rose-400 bg-rose-500/10" : "text-slate-500 bg-slate-500/10"}
              label="Overdue starts" value={String(kpis!.overdue)}
              hint="scheduled, not yet started" />
          </div>

          {/* ---- Overdue bottleneck strip ---- */}
          {kpis!.overdue > 0 && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-amber-900/50 bg-amber-950/30 px-4 py-2.5 text-[11px] font-bold text-amber-300">
              <span className="uppercase tracking-widest text-amber-500">Bottleneck</span>
              {data.machines
                .filter((m) => m.overdue > 0)
                .map((m) => (
                  <span key={m.machineId}>
                    {m.code} <span className="text-amber-200">×{m.overdue}</span>
                  </span>
                ))}
            </div>
          )}

          {/* ---- Machine table ---- */}
          <div className="overflow-x-auto rounded-2xl border border-slate-800/80 bg-slate-900/90 shadow-sm">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead>
                <tr className="border-b border-slate-800 text-[10px] uppercase tracking-widest text-slate-500">
                  <th className="px-4 py-3">Machine</th>
                  <th className="px-3 py-3">Category</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Done</th>
                  <th className="px-3 py-3 text-right">Worked</th>
                  <th className="px-3 py-3 text-right">Planned</th>
                  <th className="px-3 py-3 text-right">vs plan</th>
                  <th className="px-3 py-3 text-right">On-time</th>
                  <th className="px-3 py-3 text-right">In flight</th>
                  <th className="px-3 py-3 text-right">Overdue</th>
                </tr>
              </thead>
              <tbody>
                {data.machines.map((m) => {
                  const coverage = m.plannedMinutes > 0 ? m.actualMinutes / m.plannedMinutes : null;
                  const tone =
                    coverage == null
                      ? "text-slate-500"
                      : coverage > 1.15
                        ? "text-rose-400"
                        : coverage > 1
                          ? "text-amber-400"
                          : "text-emerald-400";
                  const idle = m.completed === 0 && m.started === 0 && m.inFlight === 0;
                  return (
                    <tr key={m.machineId} className={`border-b border-slate-800/60 last:border-0 ${idle ? "text-slate-500" : "text-slate-300"}`}>
                      <td className="px-4 py-2.5 font-black text-white">{m.code}</td>
                      <td className="px-3 py-2.5">{m.category || "—"}</td>
                      <td className="px-3 py-2.5">{m.status}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{m.completed}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{hours(m.actualMinutes)}</td>
                      <td className="px-3 py-2.5 text-right font-mono">{m.plannedMinutes > 0 ? hours(m.plannedMinutes) : "—"}</td>
                      <td className={`px-3 py-2.5 text-right font-mono font-black ${tone}`}>{pct(coverage)}</td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {m.started > 0 ? `${m.onTimeStarts}/${m.started}` : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">{m.inFlight || "—"}</td>
                      <td className={`px-3 py-2.5 text-right font-mono ${m.overdue > 0 ? "font-black text-amber-400" : ""}`}>
                        {m.overdue || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* ---- Operator ranking ---- */}
          {data.operators.length > 0 && (
            <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-amber-400" />
                <h3 className="text-sm font-black text-white">Operator ranking · {data.label}</h3>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {data.operators.slice(0, 6).map((op, index) => (
                  <div key={op.operatorId} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2.5">
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-xs font-black ${index === 0 ? "bg-amber-500/20 text-amber-300" : "bg-slate-800 text-slate-400"}`}>
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-white">{op.name}</div>
                      <div className="text-[10px] text-slate-500">
                        {op.completed} done · {hours(op.actualMinutes)}
                        {op.started > 0 ? ` · on-time ${op.onTimeStarts}/${op.started}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function KpiCard({
  icon: Icon,
  tint,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tint: string;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`rounded-lg p-1.5 ${tint}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">{label}</span>
      </div>
      <div className="mt-2 text-2xl font-black tracking-tight text-white">{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{hint}</div>
    </div>
  );
}
