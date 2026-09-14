"use client";

import React, { useState, useEffect } from "react";
import { Search, Plus, ShieldAlert, Menu, LockKeyhole, UserRoundCog, Power, DatabaseBackup, ArchiveRestore } from "lucide-react";

interface HeaderProps {
  activeTab: string;
  onNewOrder: () => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  currentUser: any;
  bottleneckCount: number;
  lowStockCount: number;
  onOpenMenu: () => void;
  onSwitchProfile: () => void;
  onLock: () => void;
  onExit: () => void;
  canCreateOrder: boolean;
}

export default function Header({
  activeTab,
  onNewOrder,
  searchQuery,
  setSearchQuery,
  currentUser,
  bottleneckCount,
  lowStockCount,
  onOpenMenu,
  onSwitchProfile,
  onLock,
  onExit,
  canCreateOrder,
}: HeaderProps) {
  const [timeStr, setTimeStr] = useState("");
  const [dbBusy, setDbBusy] = useState(false);
  const [dbMsg, setDbMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [showRestore, setShowRestore] = useState(false);
  const [dumps, setDumps] = useState<{ file: string; sizeKb: number; at: number }[]>([]);

  const flash = (kind: "ok" | "err", text: string) => {
    setDbMsg({ kind, text });
    setTimeout(() => setDbMsg(null), 6000);
  };

  const doBackup = async () => {
    if (dbBusy) return;
    if (!confirm("Create a database backup now?")) return;
    setDbBusy(true);
    try {
      const res = await fetch("/api/admin/dbtools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backup" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Backup failed");
      flash("ok", `Backup saved: ${d.file} (${d.sizeKb} KB)`);
    } catch (e: any) {
      flash("err", e?.message || "Backup failed");
    }
    setDbBusy(false);
  };

  const openRestore = async () => {
    const next = !showRestore;
    setShowRestore(next);
    if (!next) return;
    try {
      const r = await fetch("/api/admin/dbtools", { cache: "no-store" });
      const d = await r.json().catch(() => ({}));
      setDumps(Array.isArray(d.dumps) ? d.dumps : []);
    } catch {
      setDumps([]);
    }
  };

  const doRestore = async (file: string) => {
    if (dbBusy) return;
    if (!confirm(`RESTORE ${file}?

All current data will be REPLACED by this backup. The app reloads afterwards.`)) return;
    setDbBusy(true);
    setShowRestore(false);
    try {
      const res = await fetch("/api/admin/dbtools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", file }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Restore failed");
      flash("ok", `Restored ${file} — reloading…`);
      setTimeout(() => window.location.reload(), 1500);
    } catch (e: any) {
      flash("err", e?.message || "Restore failed");
      setDbBusy(false);
    }
  };

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const getTitle = () => {
    if (activeTab === "dashboard") return "Executive Control & Shop Analytics";
    if (activeTab === "orders") return "Order Workflow Routing & Operations";
    if (activeTab === "schedule") return "Dispatch Schedule & Machine Capacity";
    if (activeTab.startsWith("order-")) return "Order Manufacturing Workflow Detail";
    if (activeTab === "machines") return "Shop Floor Equipment Monitor";
    if (activeTab === "station") return "Operator Touchscreen Mode";
    if (activeTab === "customers") return "Client Accounts & Projects";
    if (activeTab === "inventory") return "Raw Panels & Edge Stock";
    if (activeTab === "gantt") return "Production Gantt Chart";
    if (activeTab === "cmms") return "Plant Asset Analytics & CMMS";
    if (activeTab === "wip") return "Live Work-In-Progress Board";
    if (activeTab === "quality") return "Scrap & Rework Control";
    if (activeTab === "downtime") return "Machine Downtime Log";
    if (activeTab === "reports") return "System Report Generator";
    if (activeTab === "settings") return "General Settings & Configuration";
    return "WoodTek ERP Platform";
  };

  const iconBtn =
    "flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/80 bg-slate-800/60 text-slate-300 transition hover:border-slate-600 hover:bg-slate-700/70 hover:text-white";

  return (
    <header className="sticky top-0 z-30 flex min-h-16 items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/70 px-3 py-3 backdrop-blur-xl sm:px-6">
      {/* Title & context */}
      <div className="flex min-w-0 items-center gap-3">
        <button onClick={onOpenMenu} className={`${iconBtn} md:hidden`} aria-label="Open navigation">
          <Menu className="h-5 w-5" />
        </button>

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="hidden h-4 w-1 shrink-0 rounded-full bg-gradient-to-b from-amber-400 to-amber-600 sm:block" />
            <h2 className="truncate text-sm font-bold tracking-tight text-white sm:text-base">
              {getTitle()}
            </h2>
          </div>
          <p className="mt-0.5 hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500 sm:block">
            WoodTek ERP · Furniture Service Center
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2.5">
        {/* Live clock */}
        <div className="hidden items-center gap-2 rounded-full border border-slate-700/70 bg-slate-800/50 px-3 py-1.5 text-xs font-medium text-slate-300 md:flex">
          <span className="h-2 w-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.9)]" />
          <span className="font-mono text-white">{timeStr || "--:--:--"}</span>
        </div>

        {/* Search */}
        <div className="relative hidden w-64 sm:block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search orders, clients, machines…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-700/80 bg-slate-950/70 py-1.5 pl-9 pr-12 text-xs text-white placeholder-slate-500 transition focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-slate-700 bg-slate-800/80 px-1.5 py-0.5 text-[9px] font-semibold text-slate-400">
            /
          </kbd>
        </div>

        {/* Alert pill */}
        {(bottleneckCount > 0 || lowStockCount > 0) && (
          <div className="hidden items-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 lg:flex">
            <ShieldAlert className="h-4 w-4 text-rose-400" />
            <span className="whitespace-nowrap">
              {bottleneckCount > 0 ? `${bottleneckCount} queue alert${bottleneckCount > 1 ? "s" : ""}` : ""}
              {bottleneckCount > 0 && lowStockCount > 0 ? " · " : ""}
              {lowStockCount > 0 ? `${lowStockCount} low stock` : ""}
            </span>
          </div>
        )}

        {currentUser?.role === "Manager" && (
          <div className="relative flex items-center gap-1.5">
            <button
              onClick={doBackup}
              disabled={dbBusy}
              className={`${iconBtn} hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-50`}
              title="Backup database"
            >
              <DatabaseBackup className="h-4 w-4" />
            </button>
            <button
              onClick={openRestore}
              disabled={dbBusy}
              className={`${iconBtn} hover:border-amber-500/50 hover:text-amber-300 disabled:opacity-50`}
              title="Restore database"
            >
              <ArchiveRestore className="h-4 w-4" />
            </button>
            {showRestore && (
              <div className="absolute right-0 top-10 z-50 w-80 rounded-xl border border-slate-700 bg-slate-900 p-2 shadow-2xl">
                <div className="px-1 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
                  Restore database from backup
                </div>
                {dumps.length === 0 && (
                  <div className="px-1 pb-1 text-xs text-slate-500 italic">No database backups yet — use the backup button first.</div>
                )}
                <div className="max-h-64 overflow-y-auto space-y-0.5">
                  {dumps.map((d) => (
                    <div key={d.file} className="flex items-center justify-between gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-800">
                      <div className="min-w-0">
                        <div className="truncate text-[11px] font-bold text-slate-200">{d.file}</div>
                        <div className="text-[9px] text-slate-500">
                          {d.sizeKb} KB · {new Date(d.at).toLocaleString()}
                        </div>
                      </div>
                      <button
                        onClick={() => doRestore(d.file)}
                        className="shrink-0 rounded-lg bg-amber-600 px-2 py-1 text-[10px] font-black text-white hover:bg-amber-500"
                      >
                        RESTORE
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {dbMsg && (
          <div
            className={`fixed left-1/2 top-16 z-[120] -translate-x-1/2 rounded-xl border px-4 py-2 text-xs font-black shadow-2xl ${
              dbMsg.kind === "ok"
                ? "border-emerald-500/50 bg-emerald-950 text-emerald-300"
                : "border-rose-500/50 bg-rose-950 text-rose-300"
            }`}
          >
            {dbMsg.text}
          </div>
        )}

        <button onClick={onSwitchProfile} className={`${iconBtn} hidden sm:flex`} title={`Switch profile — ${currentUser?.name || "employee"}`}>
          <UserRoundCog className="h-4 w-4" />
        </button>
        <button onClick={onLock} className={`${iconBtn} hover:border-rose-500/50 hover:text-rose-300`} title="Lock workspace">
          <LockKeyhole className="h-4 w-4" />
        </button>
        <button onClick={onExit} className={`${iconBtn} hover:border-red-500/60 hover:bg-red-500/10 hover:text-red-300`} title="Exit WoodTek ERP">
          <Power className="h-4 w-4" />
        </button>

        {canCreateOrder && (
          <button
            onClick={onNewOrder}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-gradient-to-b from-amber-400 to-amber-600 px-3.5 py-2 text-xs font-black text-slate-950 shadow-lg shadow-amber-950/40 ring-1 ring-inset ring-amber-300/40 transition hover:from-amber-300 hover:to-amber-500 active:scale-[0.97]"
          >
            <Plus className="h-4 w-4 stroke-[2.5]" />
            <span className="hidden sm:inline">New Order Flow</span>
            <span className="sm:hidden">Order</span>
          </button>
        )}
      </div>
    </header>
  );
}
