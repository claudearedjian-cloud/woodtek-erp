"use client";

// ============================================================================
// Plant Performance tab — the OEE & Plant Performance panel that used to live
// on the Executive Dashboard, now a standalone screen (module id "plant").
// Fetches its own data from /api/dashboard?window=... (same payload as the
// dashboard; only the oee block is used here).
// ============================================================================

import React, { useEffect, useState } from "react";
import {
  DollarSign,
  TrendingUp,
  ArrowRight,
  Flame,
  Gauge,
  Timer,
  RefreshCcw,
} from "lucide-react";

interface PlantViewProps {
  onNavigate: (tab: string) => void;
}

const OEE_WINDOWS = [
  { id: "today", label: "Today" },
  { id: "7d", label: "7 Days" },
  { id: "30d", label: "30 Days" },
] as const;

export default function PlantView({ onNavigate }: PlantViewProps) {
  const [oeeWindow, setOeeWindow] = useState<"today" | "7d" | "30d">("7d");
  const [oee, setOee] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/dashboard?window=${oeeWindow}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => {
        if (!cancelled && p?.oee) setOee(p.oee);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [oeeWindow]);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-black text-white tracking-tight">Plant Performance</h2>
          <p className="text-xs text-slate-400 mt-0.5">OEE, availability, quality and loss signals across the shop floor.</p>
        </div>
      </div>
      {loading && !oee ? (
        <div className="h-80 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20 animate-pulse" />
      ) : (
        <OeePanel oee={oee} window={oeeWindow} onWindowChange={(w) => setOeeWindow(w)} onNavigate={onNavigate} />
      )}
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
