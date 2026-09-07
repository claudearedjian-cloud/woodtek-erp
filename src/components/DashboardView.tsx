"use client";

import React, { useEffect, useState } from "react";
import { 
  DollarSign, 
  Layers, 
  Cpu, 
  AlertTriangle, 
  Clock, 
  CheckCircle2, 
  TrendingUp, 
  ArrowRight, 
  Wrench, 
  Activity, 
  Flame, 
  User, 
  Zap,
  Gauge,
  Timer,
  RefreshCcw
} from "lucide-react";

interface DashboardViewProps {
  data: any;
  loading: boolean;
  onNavigate: (tab: string) => void;
}

const OEE_WINDOWS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 Days" },
  { id: "30d", label: "30 Days" },
] as const;

export default function DashboardView({ data, loading, onNavigate }: DashboardViewProps) {
  const [oeeWindow, setOeeWindow] = useState<"today" | "7d" | "30d">("7d");
  const [oee, setOee] = useState<any>(data?.oee ?? null);

  useEffect(() => {
    if (data?.oee) setOee(data.oee);
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dashboard?window=${oeeWindow}`, { cache: "no-store" })
      .then(r => (r.ok ? r.json() : null))
      .then(p => { if (!cancelled && p?.oee) setOee(p.oee); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [oeeWindow]);
  if (loading || !data) {
    return (
      <div className="p-6 space-y-6">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
          <h2 className="text-sm font-black tracking-wide text-slate-300">Loading your workspace…</h2>
          <span className="ml-auto inline-block h-2.5 w-24 animate-pulse rounded-full bg-slate-800" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 animate-pulse">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-pulse">
          <div className="lg:col-span-2 h-80 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />
          <div className="h-80 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />
        </div>
      </div>
    );
  }

  const { kpis = {}, machineWorkloads = [], primaryBottleneck, lowStockItems = [], activeShopJobs = [], orderStatusDistribution = {} } = data;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Bottleneck Warning Banner */}
      {primaryBottleneck && primaryBottleneck.queueLength > 1 && (
        <div className="bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-rose-500/10 border border-amber-500/30 rounded-2xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg shadow-amber-950/20">
          <div className="flex items-start md:items-center gap-3.5">
            <div className="p-3 bg-amber-500/20 border border-amber-500/30 rounded-xl text-amber-400">
              <Flame className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-white text-base">Production Queue Alert</span>
                <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold uppercase">
                  Station {primaryBottleneck.code}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5 leading-relaxed">
                <strong>{primaryBottleneck.name}</strong> currently has the highest workload with <strong className="text-amber-300">{primaryBottleneck.queueLength} operations queued ({primaryBottleneck.estimatedHours} est. hours)</strong>. Consider shifting jobs or adjusting operator focus.
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate("machines")}
            className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold px-4 py-2 rounded-xl text-xs border border-slate-600 transition shadow-sm whitespace-nowrap"
          >
            <span>Inspect Machine Load</span>
            <ArrowRight className="w-4 h-4 text-amber-400" />
          </button>
        </div>
      )}

      {/* KPI Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Orders */}
        <div 
          onClick={() => onNavigate("orders")}
          className="bg-slate-900/90 hover:bg-slate-800/80 border border-slate-800/80 rounded-2xl p-5 shadow-sm transition cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Production</span>
            <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400 group-hover:bg-amber-500 group-hover:text-white transition">
              <Layers className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-black text-white tracking-tight">{kpis.activeOrdersCount || 0}</div>
          <div className="flex items-center gap-1.5 mt-2 text-xs font-medium text-slate-400">
            <span className="text-emerald-400 font-bold flex items-center gap-0.5">
              <TrendingUp className="w-3.5 h-3.5" /> {kpis.urgentOrdersCount} urgent
            </span>
            <span>in shop pipeline</span>
          </div>
        </div>

        {/* Pipeline Value */}
        <div 
          onClick={() => onNavigate("orders")}
          className="bg-slate-900/90 hover:bg-slate-800/80 border border-slate-800/80 rounded-2xl p-5 shadow-sm transition cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">WIP Pipeline Value</span>
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 group-hover:bg-emerald-500 group-hover:text-white transition">
              <DollarSign className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-black text-white tracking-tight">{kpis.totalPipelineValue != null ? `$${Number(kpis.totalPipelineValue).toLocaleString()}` : <span className="text-slate-600 italic text-lg">restricted</span>}</div>
          <div className="flex items-center gap-1.5 mt-2 text-xs font-medium text-slate-400">
            <span>Across {kpis.customerCount} commercial clients</span>
          </div>
        </div>

        {/* Machine Utilization */}
        <div 
          onClick={() => onNavigate("machines")}
          className="bg-slate-900/90 hover:bg-slate-800/80 border border-slate-800/80 rounded-2xl p-5 shadow-sm transition cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Machine Utilization</span>
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 group-hover:bg-blue-500 group-hover:text-white transition">
              <Cpu className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-black text-white tracking-tight">{kpis.utilizationRate}%</div>
          <div className="w-full bg-slate-800 h-1.5 rounded-full mt-2.5 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-500 to-amber-500 h-full rounded-full" style={{ width: `${kpis.utilizationRate}%` }} />
          </div>
          <div className="flex items-center justify-between mt-1.5 text-[11px] font-medium text-slate-400">
            <span>{kpis.inUseMachines} / {kpis.totalMachines} operational</span>
            {kpis.maintenanceMachines > 0 && (
              <span className="text-amber-400 font-bold">{kpis.maintenanceMachines} in maintenance</span>
            )}
          </div>
        </div>

        {/* Inventory Stock Alerts */}
        <div 
          onClick={() => onNavigate("inventory")}
          className="bg-slate-900/90 hover:bg-slate-800/80 border border-slate-800/80 rounded-2xl p-5 shadow-sm transition cursor-pointer group"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Material Warnings</span>
            <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-400 group-hover:bg-rose-500 group-hover:text-white transition">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
          <div className="text-3xl font-black text-white tracking-tight">{kpis.inventoryAlertsCount || 0}</div>
          <div className="flex items-center gap-1.5 mt-2 text-xs font-medium text-slate-400">
            {kpis.inventoryAlertsCount > 0 ? (
              <span className="text-rose-400 font-bold flex items-center gap-1">
                At or below reorder threshold
              </span>
            ) : (
              <span className="text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> All panels fully stocked
              </span>
            )}
          </div>
        </div>
      </div>

      {/* OEE & Plant Performance */}
      <OeePanel oee={oee} window={oeeWindow} onWindowChange={(w) => setOeeWindow(w)} onNavigate={onNavigate} />

      {/* Main Row: Live Manufacturing Stream & Machine Queue Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Active Shop Floor Feed */}
        <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-sm flex flex-col">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
            <div className="flex items-center gap-2.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping" />
              <h3 className="font-bold text-white text-base tracking-tight">Live Shop Floor Operations Feed</h3>
            </div>
            <button
              onClick={() => onNavigate("station")}
              className="text-xs font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1 transition"
            >
              <span>Launch Touchscreen Station Mode</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {activeShopJobs.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 py-12">
              <Clock className="w-12 h-12 mb-3 stroke-[1.5] text-slate-600" />
              <p className="text-sm font-medium">No operations currently active on machine floor.</p>
              <button
                onClick={() => onNavigate("orders")}
                className="mt-3 text-xs bg-amber-600/20 text-amber-400 font-bold px-4 py-2 rounded-lg border border-amber-500/30 hover:bg-amber-600 hover:text-white transition"
              >
                Schedule Orders Now
              </button>
            </div>
          ) : (
            <div className="space-y-3 flex-1 overflow-y-auto pr-1">
              {activeShopJobs.map((job: any) => {
                const isRunning = job.status === "In Progress";
                return (
                  <div 
                    key={job.id} 
                    onClick={() => onNavigate(`order-${job.orderId}`)}
                    className="p-3.5 bg-slate-950/70 hover:bg-slate-800/60 border border-slate-800 hover:border-amber-500/40 rounded-xl transition cursor-pointer flex items-center justify-between gap-4 group"
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`p-2.5 rounded-xl border flex-shrink-0 ${
                        isRunning 
                          ? "bg-amber-500/10 border-amber-500/30 text-amber-400" 
                          : "bg-slate-800/80 border-slate-700 text-slate-300"
                      }`}>
                        <Activity className={`w-5 h-5 ${isRunning ? "animate-spin" : ""}`} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-extrabold text-white text-sm truncate group-hover:text-amber-400 transition">
                            {job.operationName}
                          </span>
                          <span className={`text-[10px] px-2 py-0.5 rounded font-extrabold uppercase tracking-wider ${
                            isRunning ? "bg-amber-500 text-slate-950" : "bg-slate-800 text-slate-300 border border-slate-700"
                          }`}>
                            {job.status}
                          </span>
                        </div>
                        <div className="text-xs text-slate-400 truncate mt-1 flex items-center gap-2">
                          <span className="font-mono text-slate-300 font-bold">{job.orderNumber}</span>
                          <span>•</span>
                          <span className="truncate">{job.orderTitle}</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0 hidden sm:block">
                      <div className="text-xs font-extrabold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded border border-amber-500/20 inline-block">
                        {job.machineCode || "Any Machine"}
                      </div>
                      <div className="text-[11px] text-slate-400 font-medium mt-1 flex items-center justify-end gap-1">
                        <User className="w-3 h-3 text-slate-500" /> 
                        <span>{job.operatorName || "Shop Operator"} ({job.estimatedMinutes} min)</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right: Machine Status Summary & Queue */}
        <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-sm flex flex-col">
          <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
            <h3 className="font-bold text-white text-base tracking-tight flex items-center gap-2">
              <Cpu className="w-4 h-4 text-blue-400" />
              <span>Machine Stations</span>
            </h3>
            <span className="text-xs text-slate-400 font-medium">{machineWorkloads.length} total units</span>
          </div>

          <div className="space-y-2.5 flex-1 overflow-y-auto pr-1">
            {machineWorkloads.map((m: any) => {
              const inUse = m.status === "In-Use" || m.status === "Active" && m.queueLength > 0;
              const isMaintenance = m.status === "Maintenance";
              
              return (
                <div 
                  key={m.machineId}
                  onClick={() => onNavigate("machines")}
                  className="p-3 bg-slate-950/60 hover:bg-slate-800/60 border border-slate-800/80 rounded-xl transition cursor-pointer flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-extrabold text-amber-400">{m.code}</span>
                      <span className="font-semibold text-slate-200 text-xs truncate">{m.name}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-extrabold uppercase ${
                        isMaintenance ? "bg-rose-500/20 text-rose-300 border border-rose-500/30" : 
                        inUse ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30" : 
                        "bg-slate-800 text-slate-400"
                      }`}>
                        {m.status}
                      </span>
                      <span className="text-[11px] text-slate-500">${m.hourlyCost}/hr</span>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="text-xs font-bold text-white">
                      {m.queueLength} {m.queueLength === 1 ? "job" : "jobs"}
                    </div>
                    <div className="text-[10px] font-mono text-slate-400">
                      {m.estimatedHours} hrs est.
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function OeeGauge({ value }: { value: number | null }) {
  const radius = 62;
  const circumference = 2 * Math.PI * radius;
  const fraction = value == null ? 0 : Math.max(0, Math.min(1, value / 100));
  const color = value == null ? "#475569" : value >= 85 ? "#10b981" : value >= 70 ? "#f59e0b" : "#f43f5e";

  return (
    <div className="relative flex h-40 w-40 items-center justify-center">
      <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
        <circle cx="80" cy="80" r={radius} fill="none" stroke="#1e293b" strokeWidth="14" />
        <circle
          cx="80" cy="80" r={radius} fill="none" stroke={color} strokeWidth="14"
          strokeLinecap="round" strokeDasharray={`${fraction * circumference} ${circumference}`}
          style={{ transition: "stroke-dasharray 0.6s ease, stroke 0.3s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-black tracking-tight text-white">{value == null ? "—" : `${value}%`}</span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">OEE</span>
      </div>
    </div>
  );
}

function ComponentBar({ label, value, color, hint }: { label: string; value: number | null; color: string; hint?: string }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs font-bold text-slate-300">{label}</span>
        <span className="font-mono text-sm font-black" style={{ color }}>{value == null ? "—" : `${value}%`}</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${value == null ? 0 : value}%`, background: color }}
        />
      </div>
      {hint && <div className="mt-1 text-[10px] text-slate-500">{hint}</div>}
    </div>
  );
}

function OeePanel({
  oee,
  window,
  onWindowChange,
  onNavigate,
}: {
  oee: any;
  window: "today" | "7d" | "30d";
  onWindowChange: (w: "today" | "7d" | "30d") => void;
  onNavigate: (tab: string) => void;
}) {
  const oeeValue: number | null = oee?.oee ?? null;
  const oeeColor = oeeValue == null ? "#64748b" : oeeValue >= 85 ? "#10b981" : oeeValue >= 70 ? "#f59e0b" : "#f43f5e";
  const machines = oee?.machineAvailability ?? [];

  return (
    <div className="rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm">
      <div className="mb-5 flex flex-col gap-3 border-b border-slate-800 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5">
          <div className="rounded-lg bg-blue-500/10 p-2 text-blue-400"><Gauge className="h-5 w-5" /></div>
          <div>
            <h3 className="text-base font-black text-white">OEE &amp; Plant Performance</h3>
            <p className="text-[11px] text-slate-400">{oee?.windowLabel ?? "Last 7 days"} · availability × performance × quality</p>
          </div>
        </div>
        <div className="flex items-center rounded-xl border border-slate-800 bg-slate-950 p-1">
          {OEE_WINDOWS.map((w) => (
            <button
              key={w.id}
              onClick={() => onWindowChange(w.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                window === w.id ? "bg-slate-800 text-amber-400" : "text-slate-400 hover:text-white"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Composite OEE gauge */}
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
          <OeeGauge value={oeeValue} />
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[10px] font-semibold text-slate-500">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" /> ≥85% world-class</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-500" /> ≥70% good</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-rose-500" /> &lt;70% needs focus</span>
          </div>
          <button
            onClick={() => onNavigate("reports")}
            className="mt-3 flex items-center gap-1 text-xs font-bold text-amber-400 hover:text-amber-300 transition"
          >
            <TrendingUp className="h-3.5 w-3.5" /> Deep-dive in Reports <ArrowRight className="h-3 w-3" />
          </button>
        </div>

        {/* Component bars */}
        <div className="flex flex-col justify-center gap-5 rounded-2xl border border-slate-800 bg-slate-950/60 p-5">
          <ComponentBar label="Availability" value={oee?.availability ?? null} color="#38bdf8" hint={`${oee?.totalDowntimeHours ?? 0}h downtime`} />
          <ComponentBar label="Performance" value={oee?.performance ?? null} color="#a78bfa" hint={`${oee?.completedOps ?? 0} completed ops`} />
          <ComponentBar label="Quality" value={oee?.quality ?? null} color="#34d399" hint={`${oee?.rejectedOps ?? 0} rejected / rework ops`} />
        </div>

        {/* Loss signals */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400"><Timer className="h-4 w-4 text-rose-400" /> Downtime</div>
            <div className="mt-1 text-2xl font-black text-white">{oee?.totalDowntimeHours ?? 0}<span className="text-sm font-bold text-slate-500"> hrs</span></div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400"><DollarSign className="h-4 w-4 text-rose-400" /> Scrap cost</div>
            <div className="mt-1 text-2xl font-black text-white">${Number(oee?.scrapCost ?? 0).toLocaleString()}</div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400"><Flame className="h-4 w-4 text-orange-400" /> Scrap qty</div>
            <div className="mt-1 text-2xl font-black text-white">{oee?.scrapQty ?? 0}<span className="text-sm font-bold text-slate-500"> pcs</span></div>
          </div>
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-400"><RefreshCcw className="h-4 w-4 text-amber-400" /> Open rework</div>
            <div className={`mt-1 text-2xl font-black ${(oee?.openRework ?? 0) > 0 ? "text-amber-300" : "text-emerald-400"}`}>{oee?.openRework ?? 0}</div>
          </div>
        </div>
      </div>

      {/* Per-machine availability */}
      {machines.length > 0 && (
        <div className="mt-5 border-t border-slate-800 pt-4">
          <div className="mb-3 flex items-center justify-between">
            <h4 className="text-xs font-black uppercase tracking-wider text-slate-300">Station availability</h4>
            <button onClick={() => onNavigate("downtime")} className="flex items-center gap-1 text-[11px] font-bold text-amber-400 hover:text-amber-300 transition">
              Downtime log <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
            {machines.map((m: any) => (
              <div key={m.machineId} className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="font-mono text-[11px] font-black text-amber-400">{m.code}</span>
                  <span className={`font-mono text-xs font-black ${m.availability >= 95 ? "text-emerald-400" : m.availability >= 80 ? "text-amber-300" : "text-rose-400"}`}>{m.availability}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
                  <div
                    className={`h-full rounded-full ${m.availability >= 95 ? "bg-emerald-500" : m.availability >= 80 ? "bg-amber-500" : "bg-rose-500"}`}
                    style={{ width: `${m.availability}%` }}
                  />
                </div>
                <div className="mt-1 truncate text-[10px] text-slate-500">{m.downtimeMinutes > 0 ? `${m.downtimeMinutes}m down` : "no downtime"}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
