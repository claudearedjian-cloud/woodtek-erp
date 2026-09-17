"use client";

import React from "react";
import { AlertTriangle, Clock3, ExternalLink, ShieldAlert, X } from "lucide-react";

export interface LoginDowntimeEvent {
  id: number;
  machineCode?: string | null;
  machineName?: string | null;
  reason?: string | null;
  startedAt?: string | Date | null;
  orderNumber?: string | null;
  operatorName?: string | null;
  notes?: string | null;
  endedAt?: string | Date | null;
}

function elapsedLabel(startedAt: LoginDowntimeEvent["startedAt"], now = Date.now()): string {
  const started = startedAt ? new Date(startedAt).getTime() : Number.NaN;
  if (!Number.isFinite(started)) return "duration unavailable";
  const minutes = Math.max(0, Math.floor((now - started) / 60000));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${remainder}m` : `${minutes}m`;
}

export default function MachineDowntimeLoginAlert({
  events,
  onAcknowledge,
  onOpenDowntime,
}: {
  events: LoginDowntimeEvent[];
  onAcknowledge: () => void;
  onOpenDowntime: () => void;
}) {
  const activeEvents = events.filter((event) => !event.endedAt);
  if (activeEvents.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[10050] flex items-center justify-center overflow-y-auto bg-slate-950/90 p-4 backdrop-blur-md"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="machine-downtime-login-title"
      aria-describedby="machine-downtime-login-description"
    >
      <div className="my-auto w-full max-w-3xl overflow-hidden rounded-3xl border border-rose-500/60 bg-slate-900 shadow-2xl shadow-rose-950/60">
        <header className="relative border-b border-rose-500/30 bg-gradient-to-r from-rose-950/90 via-slate-950 to-rose-950/80 px-5 py-5 sm:px-7">
          <button
            type="button"
            onClick={onAcknowledge}
            className="absolute right-4 top-4 rounded-xl border border-rose-400/25 bg-slate-950/60 p-2 text-rose-200 transition hover:bg-rose-500/20 hover:text-white"
            aria-label="Acknowledge and close downtime warning"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="flex items-start gap-4 pr-10">
            <div className="relative mt-0.5 flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-rose-400/50 bg-rose-500/20 text-rose-300">
              <span className="absolute inset-0 animate-ping rounded-2xl bg-rose-500/15" />
              <ShieldAlert className="relative h-6 w-6" />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.24em] text-rose-300">Manager login safety check</div>
              <h2 id="machine-downtime-login-title" className="mt-1 text-xl font-black tracking-tight text-white sm:text-2xl">
                MACHINE DOWNTIME WARNING
              </h2>
              <p id="machine-downtime-login-description" className="mt-1.5 text-sm font-bold text-rose-100">
                {activeEvents.length} {activeEvents.length === 1 ? "machine is" : "machines are"} currently marked down.
              </p>
            </div>
          </div>
        </header>

        <div className="max-h-[55vh] space-y-3 overflow-y-auto p-4 custom-scrollbar sm:p-6">
          {activeEvents.map((event) => (
            <article key={event.id} className="rounded-2xl border border-rose-500/35 bg-rose-500/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-lg font-black text-rose-300">{event.machineCode || `Machine #${event.id}`}</span>
                    {event.machineName && <span className="text-sm font-extrabold text-white">{event.machineName}</span>}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5 text-sm font-black text-rose-100">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
                    {event.reason || "Unspecified downtime"}
                  </div>
                </div>
                <span className="flex shrink-0 items-center gap-1.5 rounded-xl border border-rose-500/30 bg-slate-950/70 px-3 py-1.5 text-xs font-black text-rose-200">
                  <Clock3 className="h-3.5 w-3.5" /> Down {elapsedLabel(event.startedAt)}
                </span>
              </div>
              {(event.orderNumber || event.operatorName) && (
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs font-bold text-slate-300">
                  {event.orderNumber && <span>Order: <strong className="font-mono text-amber-300">{event.orderNumber}</strong></span>}
                  {event.operatorName && <span>Reported by: <strong className="text-white">{event.operatorName}</strong></span>}
                </div>
              )}
              {event.notes && <p className="mt-2 rounded-xl bg-slate-950/50 px-3 py-2 text-xs leading-relaxed text-slate-300">{event.notes}</p>}
            </article>
          ))}
        </div>

        <footer className="flex flex-col-reverse gap-2 border-t border-slate-800 bg-slate-950/70 px-4 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button
            type="button"
            onClick={onAcknowledge}
            className="rounded-xl border border-slate-700 bg-slate-900 px-5 py-3 text-xs font-black uppercase tracking-wider text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            Acknowledge
          </button>
          <button
            type="button"
            onClick={onOpenDowntime}
            className="flex items-center justify-center gap-2 rounded-xl bg-rose-500 px-5 py-3 text-xs font-black uppercase tracking-wider text-slate-950 transition hover:bg-rose-400"
          >
            <ExternalLink className="h-4 w-4" /> Open Downtime Log
          </button>
        </footer>
      </div>
    </div>
  );
}
