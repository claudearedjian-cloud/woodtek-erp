"use client";

// ============================================================================
// Wall board — full-screen shop-floor TV view (backlog #9).
// Opened from the WIP Board header ("Wall board" button). Reuses /api/wip,
// polls every 15 s, ticks a clock every second, and shows one big tile per
// machine (current job + elapsed + queue depth) plus the active-order strip.
// Escape or the X button exits (and leaves browser fullscreen).
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, RefreshCw, X } from "lucide-react";
import { buildWallBoard, type WallBoard } from "@/lib/wallboard";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${pad(h)}:${pad(m)}:${pad(s % 60)}`;
}

const STATE_STYLES: Record<string, string> = {
  Running: "border-emerald-500/60 bg-emerald-500/5",
  Idle: "border-slate-700 bg-slate-900/60",
  Down: "border-rose-500/70 bg-rose-500/10",
};

export default function WallBoardView({ onClose }: { onClose: () => void }) {
  const [board, setBoard] = useState<WallBoard | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const wentFullscreen = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/wip", { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error || "Failed to load the wall board.");
      setBoard(buildWallBoard(payload));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the wall board.");
    }
  }, []);

  useEffect(() => {
    load();
    const poll = setInterval(load, 15000);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const goFullscreen = () => {
    try {
      const el = document.documentElement as any;
      const fn = el.requestFullscreen || el.webkitRequestFullscreen;
      if (fn && !document.fullscreenElement) {
        fn.call(el)?.catch?.(() => {});
        wentFullscreen.current = true;
      }
    } catch {
      /* older TVs — the overlay still fills the page */
    }
  };

  const exit = () => {
    try {
      if (wentFullscreen.current && document.fullscreenElement) document.exitFullscreen?.();
    } catch {
      /* ignore */
    }
    onClose();
  };

  const stateStyle = (state: string) => STATE_STYLES[state] ?? "border-amber-500/50 bg-amber-500/5";
  const stateText = (state: string) =>
    state === "Running" ? "text-emerald-300" : state === "Down" ? "text-rose-300" : state === "Idle" ? "text-slate-400" : "text-amber-300";

  return (
    <div className="fixed inset-0 z-[100] overflow-auto bg-slate-950 p-5 text-white" onDoubleClick={goFullscreen}>
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-3xl font-black tracking-tight text-amber-400">WOODTEK</span>
          <span className="text-sm font-black uppercase tracking-[0.3em] text-slate-400">Shop floor · live</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-4xl font-black tabular-nums text-white">
            {new Date(now).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <span className="hidden text-sm font-bold text-slate-400 md:inline">
            {new Date(now).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
          </span>
          <button onClick={load} className="rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-slate-300 hover:bg-slate-800" title="Refresh now">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={goFullscreen} className="rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-slate-300 hover:bg-slate-800" title="Full screen">
            <Maximize2 className="h-4 w-4" />
          </button>
          <button onClick={exit} className="rounded-xl border border-slate-700 bg-slate-900 p-2.5 text-slate-300 hover:bg-slate-800" title="Exit the wall board (Esc)">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-300">{error}</div>
      )}

      {/* KPI strip */}
      {board && (
        <div className="mb-4 flex flex-wrap gap-3 text-sm font-black">
          <span className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-emerald-300">Running {board.kpis.running}</span>
          <span className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2 text-slate-300">Idle {board.kpis.idle}</span>
          <span className={`rounded-xl border px-4 py-2 ${board.kpis.down > 0 ? "border-rose-500/60 bg-rose-500/10 text-rose-300" : "border-slate-700 bg-slate-900 text-slate-400"}`}>Down {board.kpis.down}</span>
          <span className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-amber-300">{board.kpis.activeOrders} active order{board.kpis.activeOrders === 1 ? "" : "s"}</span>
        </div>
      )}

      {/* Machine tiles */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {(board?.machines ?? []).map((m) => (
          <div key={m.id} className={`rounded-2xl border-2 p-4 ${stateStyle(m.state)}`}>
            <div className="flex items-center justify-between">
              <span className="font-mono text-xl font-black text-white">{m.code || m.name}</span>
              <span className={`text-xs font-black uppercase tracking-widest ${stateText(m.state)}`}>{m.state}</span>
            </div>
            <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">{m.category}{m.name && m.code ? ` · ${m.name}` : ""}</div>
            {m.state === "Running" && m.currentOrder ? (
              <div className="mt-3">
                <div className="font-mono text-3xl font-black tracking-tight text-amber-400">{m.currentOrder}</div>
                {m.currentClient && <div className="mt-0.5 truncate text-base font-extrabold text-white">{m.currentClient}</div>}
                <div className="mt-0.5 truncate text-sm font-bold text-slate-300">{m.currentOperation}</div>
                <div className="mt-2 font-mono text-2xl font-black tabular-nums text-emerald-300">
                  {m.currentStartMs ? fmtClock(now - m.currentStartMs) : "--:--:--"}
                </div>
              </div>
            ) : m.state === "Down" ? (
              <div className="mt-3 text-3xl font-black text-rose-400">DOWN</div>
            ) : (
              <div className="mt-3 text-3xl font-black text-slate-600">IDLE</div>
            )}
            <div className="mt-3 text-xs font-black uppercase tracking-wider text-slate-500">
              Queue: {m.queued} op{m.queued === 1 ? "" : "s"} · ~{m.queueMinutes}m
            </div>
          </div>
        ))}
      </div>

      {/* Active orders strip */}
      {board && board.orders.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-xs font-black uppercase tracking-[0.25em] text-slate-500">Orders in production</div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-3">
            {board.orders.map((o) => (
              <div key={o.orderNumber} className="rounded-xl border border-slate-800 bg-slate-900/70 px-3.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-lg font-black text-amber-400">{o.orderNumber}</span>
                  <span className={`text-[10px] font-black uppercase tracking-wider ${o.priority === "Urgent" ? "text-rose-400" : o.priority === "High" ? "text-amber-300" : "text-slate-500"}`}>{o.priority}</span>
                </div>
                <div className="truncate text-xs font-bold text-slate-300">{o.title}{o.client ? ` · ${o.client}` : ""}</div>
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-950 border border-slate-800">
                    <div className={`h-full rounded-full ${o.progressPercent === 100 ? "bg-emerald-500" : "bg-gradient-to-r from-amber-600 to-amber-400"}`} style={{ width: `${o.progressPercent}%` }} />
                  </div>
                  <span className="w-24 text-right text-[10px] font-black text-slate-400">{o.completedSteps}/{o.totalSteps} ops · {o.progressPercent}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 text-center text-[11px] font-bold text-slate-600">
        Auto-refreshes every 15 s · double-click for full screen · Esc to exit
        {board?.generatedAt ? ` · updated ${new Date(board.generatedAt).toLocaleTimeString()}` : ""}
      </div>
    </div>
  );
}
