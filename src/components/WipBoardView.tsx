"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  Cpu,
  Flame,
  Layers,
  RefreshCw,
  Timer,
  Trash2,
  Wrench,
  Zap,
} from "lucide-react";

interface WipBoardViewProps {
  onSelectOrder: (orderId: number) => void;
  onNavigate: (tab: string) => void;
}

function fmtDuration(ms: number) {
  if (ms < 0) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return h > 0 ? `${h}h ${pad(m)}m` : m > 0 ? `${m}m ${pad(s)}s` : `${s}s`;
}

function fmtClock(ms: number) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

const STATE_STYLES: Record<string, string> = {
  Running: "bg-amber-500 text-slate-950 animate-pulse",
  Down: "bg-rose-500 text-slate-950",
  Idle: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
  Maintenance: "bg-orange-500/20 text-orange-300 border border-orange-500/40",
  Offline: "bg-slate-800 text-slate-400",
};

export default function WipBoardView({ onSelectOrder, onNavigate }: WipBoardViewProps) {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(() => Date.now());
  const mounted = useRef(true);

  const fetchBoard = async () => {
    try {
      const res = await fetch("/api/wip", { cache: "no-store" });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || "Failed to load the WIP board.");
      }
      const payload = await res.json();
      if (mounted.current) {
        setData(payload);
        setError("");
      }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : "Failed to load the WIP board.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  useEffect(() => {
    mounted.current = true;
    fetchBoard();
    const interval = setInterval(fetchBoard, 5000);
    const clock = setInterval(() => setTick(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(interval);
      clearInterval(clock);
    };
  }, []);

  if (loading) {
    return (
      <div className="p-6 space-y-6 animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => <div key={i} className="h-20 bg-slate-800/50 rounded-2xl border border-slate-800" />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="h-44 bg-slate-800/50 rounded-2xl border border-slate-800" />)}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="p-10 text-center">
        <AlertTriangle className="w-10 h-10 text-rose-400 mx-auto mb-3" />
        <p className="text-rose-300 font-bold">{error}</p>
        <p className="text-xs text-slate-500 mt-2">Check that the 0004 migration has been applied to the database.</p>
      </div>
    );
  }

  const { kpis = {}, machineBoard = [], orderBoard = [], activeDowntime = [], recentQuality = [], generatedAt } = data || {};
  const now = tick;

  const Kpi = ({ label, value, sub, tone, onClick }: any) => (
    <div
      onClick={onClick}
      className={`bg-slate-900/90 border border-slate-800/80 rounded-2xl p-4 shadow-sm transition ${onClick ? "cursor-pointer hover:border-amber-500/40" : ""}`}
    >
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{label}</div>
      <div className={`text-2xl font-black tracking-tight mt-1 ${tone || "text-white"}`}>{value}</div>
      {sub && <div className="text-[11px] font-medium text-slate-400 mt-1">{sub}</div>}
    </div>
  );

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800/80 rounded-2xl px-5 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </span>
          <div>
            <h2 className="text-lg font-black text-white tracking-tight">Live WIP Board</h2>
            <p className="text-[11px] text-slate-400 font-semibold">
              Updated {generatedAt ? new Date(generatedAt).toLocaleTimeString() : "—"} · auto-refreshes every 5s
            </p>
          </div>
        </div>
        <button
          onClick={fetchBoard}
          className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl border border-slate-700 transition"
          title="Refresh now"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi label="Running Stations" value={kpis.runningStations ?? 0} tone="text-amber-400" onClick={() => onNavigate("machines")} />
        <Kpi label="Machines Down" value={kpis.machinesDown ?? 0} tone={kpis.machinesDown > 0 ? "text-rose-400" : "text-emerald-400"} onClick={() => onNavigate("downtime")} />
        <Kpi label="Idle Stations" value={kpis.idleStations ?? 0} tone="text-slate-300" />
        <Kpi label="Active Orders" value={kpis.activeOrders ?? 0} onClick={() => onNavigate("orders")} />
        <Kpi label="Open Rework" value={kpis.openRework ?? 0} tone={kpis.openRework > 0 ? "text-orange-400" : "text-emerald-400"} onClick={() => onNavigate("quality")} />
        <Kpi label="Scrap Today" value={`${kpis.scrapTodayQty ?? 0} pcs`} tone={kpis.scrapTodayQty > 0 ? "text-rose-400" : "text-emerald-400"} onClick={() => onNavigate("quality")} />
      </div>

      {/* Machine board */}
      <div>
        <h3 className="text-sm font-black text-white uppercase tracking-wider mb-3 flex items-center gap-2">
          <Cpu className="w-4 h-4 text-blue-400" /> Machine Stations
        </h3>
        {machineBoard.length === 0 ? (
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-10 text-center text-sm text-slate-500">No stations visible for your role.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {machineBoard.map((m: any) => {
              const job = m.currentJob;
              const down = m.openDowntime;
              return (
                <div
                  key={m.id}
                  className={`rounded-2xl border p-4 shadow-sm flex flex-col gap-3 ${
                    m.state === "Down" ? "border-rose-500/50 bg-gradient-to-b from-slate-900 to-rose-950/20"
                    : m.state === "Running" ? "border-amber-500/40 bg-slate-900/90"
                    : "border-slate-800/80 bg-slate-900/90"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs font-black text-amber-400">{m.code}</span>
                      <span className="text-xs font-bold text-slate-300 truncate">{m.category}</span>
                    </div>
                    <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full ${STATE_STYLES[m.state] || "bg-slate-800 text-slate-300"}`}>
                      {m.state}
                    </span>
                  </div>

                  {down ? (
                    <div className="p-3 bg-rose-500/10 border border-rose-500/40 rounded-xl">
                      <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-rose-300">
                        <Zap className="w-3.5 h-3.5" /> Down — {down.reason}
                      </div>
                      <div className="text-xs font-bold text-rose-200 mt-1 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" /> {fmtDuration(now - new Date(down.startedAt).getTime())}
                      </div>
                      {down.orderNumber && <div className="text-[11px] text-rose-300/70 mt-1 font-mono">{down.orderNumber}</div>}
                    </div>
                  ) : job ? (
                    <div
                      onClick={() => onSelectOrder(job.orderId)}
                      className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl cursor-pointer hover:bg-amber-500/20 transition group"
                    >
                      <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-amber-400">
                        <span className="flex items-center gap-1"><Activity className="w-3.5 h-3.5 animate-spin" /> Running</span>
                        <span className="font-mono tabular-nums text-amber-300"><Timer className="w-3.5 h-3.5 inline mr-1" />{fmtClock(now - new Date(job.startTime).getTime())}</span>
                      </div>
                      <div className="text-xs font-bold text-white truncate mt-1 group-hover:text-amber-300 transition">{job.operationName}</div>
                      <div className="text-[11px] text-slate-400 truncate font-mono mt-0.5">{job.orderNumber}</div>
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-xl text-center text-xs text-slate-500 italic">
                      {m.state === "Idle" ? "Station free" : m.state}
                    </div>
                  )}

                  {m.queue.length > 0 && (
                    <div className="text-[11px] text-slate-400">
                      <span className="font-bold text-slate-300">Queue ({m.queue.length}):</span>{" "}
                      {m.queue.slice(0, 2).map((o: any) => (
                        <span key={o.id} className="inline-block bg-slate-800/80 text-slate-300 rounded px-1.5 py-0.5 mr-1 font-mono">{o.orderNumber}</span>
                      ))}
                      {m.queue.length > 2 && <span className="text-slate-500">+{m.queue.length - 2}</span>}
                      <span className="ml-1 text-slate-500">~{m.queueMinutes}m</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Orders WIP + side panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Orders in WIP */}
        <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
          <h3 className="text-sm font-black text-white uppercase tracking-wider mb-4 flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-400" /> Orders in Work
          </h3>
          {orderBoard.length === 0 ? (
            <div className="text-center py-10 text-sm text-slate-500 flex flex-col items-center gap-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-500" />
              No orders currently in production.
            </div>
          ) : (
            <div className="space-y-2.5">
              {orderBoard.map((o: any) => {
                const running = o.runningOps[0];
                const rejected = o.rejectedOps.length > 0;
                return (
                  <div
                    key={o.id}
                    onClick={() => onSelectOrder(o.id)}
                    className="p-3.5 bg-slate-950/60 hover:bg-slate-800/60 border border-slate-800 hover:border-amber-500/40 rounded-xl transition cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-xs font-black text-amber-400">{o.orderNumber}</span>
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                            o.priority === "Urgent" ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                            : o.priority === "High" ? "bg-orange-500/20 text-orange-300 border border-orange-500/40"
                            : "bg-slate-800 text-slate-300"
                          }`}>{o.priority}</span>
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{o.status}</span>
                        </div>
                        <div className="text-sm font-bold text-white truncate mt-1">{o.title}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">
                          {o.customerName || "—"} · due {new Date(o.dueDate).toLocaleDateString()}
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="text-lg font-black text-white">{o.progressPercent}%</div>
                        <div className="text-[10px] text-slate-400">{o.completedSteps}/{o.totalSteps} steps</div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      {running && (
                        <span className="flex items-center gap-1 text-[11px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/30 rounded-lg px-2 py-1">
                          <Activity className="w-3 h-3 animate-spin" /> {running.operationName} · {running.machineCode}
                          <span className="font-mono tabular-nums">{fmtClock(now - new Date(running.startTime).getTime())}</span>
                        </span>
                      )}
                      {rejected && (
                        <span className="flex items-center gap-1 text-[11px] font-bold bg-rose-500/10 text-rose-300 border border-rose-500/30 rounded-lg px-2 py-1">
                          <AlertTriangle className="w-3 h-3" /> {o.rejectedOps.length} rejected
                        </span>
                      )}
                      {o.openReworkCount > 0 && (
                        <span className="text-[11px] font-bold bg-orange-500/10 text-orange-300 border border-orange-500/30 rounded-lg px-2 py-1">
                          {o.openReworkCount} open rework
                        </span>
                      )}
                      {o.scrapQty > 0 && (
                        <span className="flex items-center gap-1 text-[11px] font-bold bg-slate-800 text-slate-300 border border-slate-700 rounded-lg px-2 py-1">
                          <Trash2 className="w-3 h-3" /> {o.scrapQty} scrapped
                        </span>
                      )}
                      <div className="ml-auto w-24 bg-slate-800 h-1.5 rounded-full overflow-hidden">
                        <div className="bg-gradient-to-r from-blue-500 to-amber-500 h-full" style={{ width: `${o.progressPercent}%` }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Side panels */}
        <div className="space-y-6">
          <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <Zap className="w-4 h-4 text-rose-400" /> Active Downtime
              </h3>
              <button onClick={() => onNavigate("downtime")} className="text-xs font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1">
                Manage <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            {activeDowntime.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-500">No machines down. 🎉</div>
            ) : (
              <div className="space-y-2">
                {activeDowntime.map((d: any) => (
                  <div key={d.id} className="p-3 bg-rose-500/10 border border-rose-500/40 rounded-xl">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs font-black text-rose-300">{d.machineCode}</span>
                      <span className="text-[11px] font-bold text-rose-200 flex items-center gap-1">
                        <Clock className="w-3 h-3" /> {fmtDuration(now - new Date(d.startedAt).getTime())}
                      </span>
                    </div>
                    <div className="text-[11px] text-rose-300/80 mt-0.5">{d.reason}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-400" /> Recent Defects
              </h3>
              <button onClick={() => onNavigate("quality")} className="text-xs font-bold text-amber-400 hover:text-amber-300 flex items-center gap-1">
                Quality <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            {recentQuality.length === 0 ? (
              <div className="text-center py-6 text-xs text-slate-500">No defects recorded.</div>
            ) : (
              <div className="space-y-2">
                {recentQuality.map((q: any) => (
                  <div key={q.id} className="flex items-center gap-2.5 p-2.5 bg-slate-950/60 border border-slate-800 rounded-xl">
                    <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${
                      q.eventType === "scrap" ? "bg-rose-500/20 text-rose-300 border border-rose-500/40" : "bg-orange-500/20 text-orange-300 border border-orange-500/40"
                    }`}>{q.eventType}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-bold text-slate-200 truncate">{q.reason} · {q.quantity} {q.unit}</div>
                      <div className="text-[10px] text-slate-500 font-mono truncate">{q.orderNumber}{q.machineCode ? ` · ${q.machineCode}` : ""}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-slate-900/90 border border-slate-800/80 rounded-2xl p-5 shadow-sm">
            <h3 className="text-sm font-black text-white uppercase tracking-wider mb-2 flex items-center gap-2">
              <Wrench className="w-4 h-4 text-blue-400" /> Floor Actions
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => onNavigate("station")} className="bg-amber-600 hover:bg-amber-500 text-slate-950 font-extrabold text-xs py-2.5 rounded-xl transition">
                Operator Station
              </button>
              <button onClick={() => onNavigate("downtime")} className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-extrabold text-xs py-2.5 rounded-xl transition">
                Log Downtime
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
