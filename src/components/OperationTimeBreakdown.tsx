"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

export interface OperationTimeDetails {
  startedAt: string | null;
  executionSeconds: number;
  pausedSeconds: number;
  totalSeconds: number;
  activeSince: string | null;
  pausedSince: string | null;
  completedAt: string | null;
  snapshotAt: string;
  historyComplete: boolean;
}

export function formatOperationDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

function liveSeconds(baseSeconds: number, since: string | null, snapshotAt: string, now: number): number {
  const snapshot = new Date(snapshotAt).getTime();
  const extra = since && Number.isFinite(snapshot) ? Math.max(0, Math.floor((now - snapshot) / 1000)) : 0;
  return Math.max(0, Math.floor(Number(baseSeconds) || 0)) + extra;
}

/** Shared expandable timing breakdown for Operator Station, Dashboard and order routing. */
export default function OperationTimeBreakdown({ details }: { details?: OperationTimeDetails | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!details?.startedAt) return null;
  const execution = liveSeconds(details.executionSeconds, details.activeSince, details.snapshotAt, now);
  const paused = liveSeconds(details.pausedSeconds, details.pausedSince, details.snapshotAt, now);
  const total = liveSeconds(details.totalSeconds, details.activeSince || details.pausedSince, details.snapshotAt, now);

  return (
    <details
      className="rounded-xl border border-slate-700 bg-slate-950/80 px-3 py-2 text-xs"
      onClick={(event) => event.stopPropagation()}
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-black text-slate-300 marker:hidden">
        <ChevronDown className="h-3.5 w-3.5 text-slate-400" /> Time details
      </summary>
      <div className="mt-2 grid gap-x-5 gap-y-1 border-t border-slate-800 pt-2 sm:grid-cols-3">
        <div><span className="text-slate-500">Paused</span><strong className="ml-2 font-mono text-violet-300">{formatOperationDuration(paused)}</strong></div>
        <div><span className="text-slate-500">Execution</span><strong className="ml-2 font-mono text-amber-300">{formatOperationDuration(execution)}</strong></div>
        <div><span className="text-slate-500">Total elapsed</span><strong className="ml-2 font-mono text-white">{formatOperationDuration(total)}</strong></div>
      </div>
      {!details.historyComplete && (
        <p className="mt-2 text-[10px] font-semibold text-slate-500">
          Earlier pause history was not recorded. Detailed timing is complete from the next tracked start or resume.
        </p>
      )}
    </details>
  );
}
