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
  const [dbModal, setDbModal] = useState<null | { kind: "backup" } | { kind: "restore"; file: string }>(null);
  const [dbPhase, setDbPhase] = useState<"confirm" | "working" | "done" | "error">("confirm");
  const [dbResult, setDbResult] = useState("");
  const [showRestore, setShowRestore] = useState(false);
  const [dumps, setDumps] = useState<{ file: string; sizeKb: number; at: number }[]>([]);

  const closeDbModal = () => {
    if (dbPhase === "working") return; // never dismissible while running
    setDbModal(null);
    setDbPhase("confirm");
    setDbResult("");
  };

  const startBackup = async () => {
    setDbPhase("working");
    setDbBusy(true);
    try {
      const res = await fetch("/api/admin/dbtools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "backup" }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Backup failed");
      setDbResult(`Backup saved: ${d.file} (${d.sizeKb} KB)`);
      setDbPhase("done");
      setTimeout(() => { setDbModal(null); setDbPhase("confirm"); setDbResult(""); }, 2600);
    } catch (e: any) {
      setDbResult(e?.message || "Backup failed");
      setDbPhase("error");
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

  const askRestore = (file: string) => {
    setShowRestore(false);
    setDbPhase("confirm");
    setDbResult("");
    setDbModal({ kind: "restore", file });
  };

  const startRestore = async (file: string) => {
    setDbPhase("working");
    setDbBusy(true);
    try {
      const res = await fetch("/api/admin/dbtools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", file }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Restore failed");
      setDbResult(`Database restored from ${file} — reloading…`);
      setDbPhase("done");
      setTimeout(() => window.location.reload(), 1800);
    } catch (e: any) {
      setDbResult(e?.message || "Restore failed");
      setDbPhase("error");
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
              onClick={() => { setDbPhase("confirm"); setDbResult(""); setDbModal({ kind: "backup" }); }}
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
                        onClick={() => askRestore(d.file)}
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
        {dbModal && (
          <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
            <style>{`
              @keyframes dbpop { 0% { transform: scale(.85); opacity: 0; } 60% { transform: scale(1.04); } 100% { transform: scale(1); opacity: 1; } }
              @keyframes dbstripe { 0% { background-position: 0 0; } 100% { background-position: 28px 0; } }
              @keyframes dbpulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
            `}</style>
            <div
              className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-2xl shadow-black/60"
              style={{ animation: "dbpop .35s ease-out" }}
            >
              {dbPhase === "working" ? (
                <div className="p-8 text-center">
                  <div className="mx-auto h-14 w-14 animate-spin rounded-full border-4 border-slate-700 border-t-amber-400" />
                  <h3 className="mt-4 text-lg font-black text-white">
                    {dbModal.kind === "backup" ? "Backing up database…" : "Restoring database…"}
                  </h3>
                  <p className="mt-1 text-xs text-slate-400" style={{ animation: "dbpulse 1.4s ease-in-out infinite" }}>
                    Please keep this window open — do not switch off the server.
                  </p>
                  <div
                    className="mt-5 h-2.5 w-full rounded-full"
                    style={{
                      backgroundImage:
                        "repeating-linear-gradient(45deg, rgba(251,191,36,.9) 0 10px, rgba(251,191,36,.35) 10px 20px)",
                      backgroundSize: "28px 100%",
                      animation: "dbstripe .8s linear infinite",
                    }}
                  />
                </div>
              ) : dbPhase === "done" ? (
                <div className="p-8 text-center" style={{ animation: "dbpop .35s ease-out" }}>
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-4 border-emerald-500 bg-emerald-500/10">
                    <svg viewBox="0 0 24 24" className="h-7 w-7 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  </div>
                  <h3 className="mt-4 text-lg font-black text-emerald-300">Finished</h3>
                  <p className="mt-1 break-all text-xs font-bold text-slate-300">{dbResult}</p>
                </div>
              ) : dbPhase === "error" ? (
                <div className="p-8 text-center">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border-4 border-rose-500 bg-rose-500/10">
                    <svg viewBox="0 0 24 24" className="h-7 w-7 text-rose-400" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
                  </div>
                  <h3 className="mt-4 text-lg font-black text-rose-300">Failed</h3>
                  <p className="mt-1 break-all text-xs font-bold text-slate-300">{dbResult}</p>
                  <button
                    onClick={closeDbModal}
                    className="mt-5 rounded-xl bg-slate-800 px-5 py-2 text-xs font-black text-slate-200 hover:bg-slate-700"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <div className="p-7">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl border ${dbModal.kind === "backup" ? "border-emerald-500/40 bg-emerald-500/10" : "border-amber-500/40 bg-amber-500/10"}`}>
                      {dbModal.kind === "backup" ? <DatabaseBackup className="h-5 w-5 text-emerald-300" /> : <ArchiveRestore className="h-5 w-5 text-amber-300" />}
                    </div>
                    <h3 className="text-base font-black text-white">
                      {dbModal.kind === "backup" ? "Backup Database" : "Restore Database"}
                    </h3>
                  </div>
                  <p className="mt-4 text-sm font-semibold text-slate-300">
                    {dbModal.kind === "backup"
                      ? "Are you sure you want to backup the database? A full snapshot will be saved on the server."
                      : `Are you sure you want to restore the database from ${dbModal.file}? ALL current data will be replaced by this backup.`}
                  </p>
                  <div className="mt-6 flex justify-end gap-3">
                    <button
                      onClick={closeDbModal}
                      className="rounded-xl bg-slate-800 px-4 py-2 text-xs font-black text-slate-300 hover:bg-slate-700"
                    >
                      Cancel
                    </button>
                    {dbModal.kind === "backup" ? (
                      <button
                        onClick={startBackup}
                        className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-black text-white shadow-lg shadow-emerald-950/50 hover:bg-emerald-500"
                      >
                        Yes, Backup
                      </button>
                    ) : (
                      <button
                        onClick={() => startRestore(dbModal.file)}
                        className="rounded-xl bg-amber-600 px-5 py-2 text-xs font-black text-white shadow-lg shadow-amber-950/50 hover:bg-amber-500"
                      >
                        Yes, Restore
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
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
