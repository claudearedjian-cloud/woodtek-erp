"use client";

import React, { useEffect, useMemo, useState } from "react";
import { STAGE_LABELS, type DispatchStage } from "@/lib/dispatch";
import {
  Archive,
  Calendar,
  ChevronRight,
  ClipboardList,
  Cpu,
  Filter,
  LayoutGrid,
  List,
  User,
} from "lucide-react";
import NewOrderWizard from "@/components/NewOrderWizard";

interface OrdersViewProps {
  orders: any[];
  loading: boolean;
  onSelectOrder: (orderId: number) => void;
  onRefresh: () => void;
  showNewModal: boolean;
  setShowNewModal: (val: boolean) => void;
  customers: any[];
  templates: any[];
  machines: any[];
  searchQuery?: string;
  currentUser?: any;
  inventoryItems?: any[];
  presetStatus?: string | null;
  cloneSeed?: any;
  onCloneConsumed?: () => void;
}

export default function OrdersView({
  orders = [],
  loading,
  onSelectOrder,
  onRefresh,
  showNewModal,
  setShowNewModal,
  customers = [],
  templates = [],
  machines = [],
  searchQuery = "",
  currentUser,
  inventoryItems = [],
  presetStatus = null,
  cloneSeed = null,
  onCloneConsumed,
}: OrdersViewProps) {
  const [viewMode, setViewMode] = useState<"kanban" | "list">("list");
  const [statusFilter, setStatusFilter] = useState(presetStatus ?? "All");
  // Dashboard status buttons: apply the requested filter whenever it changes.
  useEffect(() => {
    if (presetStatus) setStatusFilter(presetStatus);
  }, [presetStatus]);
  // Dispatch pipeline stage per completed order (Orders & Routing stays in sync with delivery).
  const [dispatchByOrder, setDispatchByOrder] = useState<Record<string, DispatchStage>>({});
  useEffect(() => {
    let alive = true;
    const loadDispatch = () =>
      fetch("/api/dispatch")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!alive || !data?.orders) return;
          const map: Record<string, DispatchStage> = {};
          data.orders.forEach((o: any) => { map[String(o.id)] = (o.stage || "awaiting_delivery") as DispatchStage; });
          setDispatchByOrder(map);
        })
        .catch(() => {});
    loadDispatch();
    const t = setInterval(loadDispatch, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Order archive: finished/clutter orders hidden from the default list (data/order-archive.json).
  const [archivedIds, setArchivedIds] = useState<number[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => {
    fetch("/api/order-archive", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d && Array.isArray(d.archived)) setArchivedIds(d.archived); })
      .catch(() => {});
  }, []);
  const archivedSet = useMemo(() => new Set(archivedIds), [archivedIds]);
  const canArchive = currentUser?.role === "Manager" || currentUser?.role === "Sales Coordinator";
  const toggleArchive = async (order: any) => {
    const archived = !archivedSet.has(order.id);
    try {
      const r = await fetch("/api/order-archive", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, archived }),
      });
      const d = await r.json();
      if (r.ok && Array.isArray(d.archivedIds)) setArchivedIds(d.archivedIds);
    } catch {
      /* ignore */
    }
  };
  const [priorityFilter, setPriorityFilter] = useState("All");

  // Filtered orders
  const filteredOrders = orders.filter(order => {
    // Archive: hidden unless the "Archived" toggle is on (then ONLY archived show).
    if (archivedSet.has(order.id) !== showArchived) return false;
    const matchesSearch = !searchQuery || 
      order.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      order.orderNumber.toLowerCase().includes(searchQuery.toLowerCase()) || 
      (order.customerCompany && order.customerCompany.toLowerCase().includes(searchQuery.toLowerCase()));
    
    const matchesStatus = statusFilter === "All" || order.status === statusFilter;
    const matchesPriority = priorityFilter === "All" || order.priority === priorityFilter;
    return matchesSearch && matchesStatus && matchesPriority;
  });

  const getPriorityBadge = (p: string) => {
    if (p === "Urgent") return "bg-rose-500/20 text-rose-300 border border-rose-500/30";
    if (p === "High") return "bg-amber-500/20 text-amber-300 border border-amber-500/30";
    return "bg-slate-800 text-slate-300 border border-slate-700";
  };

  const getStatusBadge = (s: string) => {
    if (s === "Completed") return "bg-emerald-500/20 text-emerald-300 border-emerald-500/30";
    if (s === "Delivered") return "bg-teal-500/20 text-teal-300 border-teal-500/30";
    if (s === "In Production") return "bg-amber-500/20 text-amber-300 border-amber-500/30";
    if (s === "Quality Review") return "bg-purple-500/20 text-purple-300 border-purple-500/30";
    if (s === "On Hold") return "bg-rose-500/20 text-rose-300 border-rose-500/30";
    return "bg-slate-800 text-slate-300 border-slate-700";
  };

  const isOverdue = (order: any) =>
    order.status !== "Completed" && order.status !== "Delivered" && new Date(order.dueDate).getTime() < Date.now();

  const kanbanColumns = [
    { title: "Pending Start", status: "Pending", color: "border-slate-600" },
    { title: "In Production", status: "In Production", color: "border-amber-500" },
    { title: "Quality Review", status: "Quality Review", color: "border-purple-500" },
    { title: "Completed & Ready", status: "Completed", color: "border-emerald-500" },
    { title: "Delivered", status: "Delivered", color: "border-teal-500" },
  ];

  if (loading) {
    return (
      <div className="p-6 space-y-6 max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
          <h2 className="text-sm font-black tracking-wide text-slate-300">Loading orders…</h2>
        </div>
        <div className="h-16 animate-pulse rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-800/60 to-slate-800/20" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Control Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-900/90 border border-slate-800/80 p-4 rounded-2xl shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-400 mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-amber-500" /> Status:
          </span>
          {["All", "Pending", "In Production", "Quality Review", "Completed", "Delivered", "On Hold", "Cancelled"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition ${
                statusFilter === s
                  ? "bg-amber-500 text-slate-950 font-extrabold shadow-sm"
                  : "bg-slate-950/60 text-slate-300 hover:bg-slate-800 border border-slate-800"
              }`}
            >
              {s}
            </button>
          ))}
          <button
            onClick={() => setShowArchived((v) => !v)}
            className={`flex items-center gap-1.5 rounded-xl px-3 py-1 text-xs font-bold transition ${
              showArchived
                ? "bg-slate-700 text-white shadow-sm"
                : "border border-slate-800 bg-slate-950/60 text-slate-400 hover:bg-slate-800"
            }`}
            title={showArchived ? "Back to the active orders" : `Show the ${archivedIds.length} archived order(s) — nothing is deleted`}
          >
            <Archive className="h-3.5 w-3.5" />
            Archived{archivedIds.length > 0 ? ` (${archivedIds.length})` : ""}
          </button>
        </div>

        <div className="flex items-center gap-3">
          {/* Priority Toggle */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-slate-200 focus:border-amber-500 focus:outline-none"
          >
            <option value="All">Priority: All</option>
            <option value="Urgent">Priority: Urgent</option>
            <option value="High">Priority: High</option>
            <option value="Normal">Priority: Normal</option>
          </select>

          {/* View Toggle */}
          <div className="flex items-center rounded-xl border border-slate-800 bg-slate-950 p-1">
            <button
              onClick={() => setViewMode("list")}
              className={`flex items-center gap-1 rounded-lg p-1.5 text-xs font-bold transition ${
                viewMode === "list" ? "bg-slate-800 text-amber-400" : "text-slate-400 hover:text-white"
              }`}
              title="List View"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode("kanban")}
              className={`flex items-center gap-1 rounded-lg p-1.5 text-xs font-bold transition ${
                viewMode === "kanban" ? "bg-slate-800 text-amber-400" : "text-slate-400 hover:text-white"
              }`}
              title="Kanban Board"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
          </div>

          {/* Results count */}
          <span className="rounded-full border border-slate-700/70 bg-slate-800/50 px-3 py-1 text-[11px] font-bold text-slate-300">
            {filteredOrders.length} {filteredOrders.length === 1 ? "order" : "orders"}
          </span>
        </div>
      </div>

      {/* Empty State */}
      {filteredOrders.length === 0 ? (
        <div className="mx-auto my-12 max-w-lg rounded-2xl border border-slate-800/80 bg-slate-900/90 p-12 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-700/70 bg-slate-950/60">
            <ClipboardList className="h-8 w-8 text-amber-500/80 stroke-[1.5]" />
          </div>
          <h3 className="mb-1 text-lg font-bold text-white">No Orders Matching Filter</h3>
          <p className="mb-6 text-xs text-slate-400">
            There are currently no manufacturing orders matching your criteria. Try resetting filters or create a new order to schedule operations.
          </p>
          <button
            onClick={() => { setStatusFilter("All"); setPriorityFilter("All"); setShowNewModal(true); }}
            className="rounded-xl bg-gradient-to-b from-amber-400 to-amber-600 px-5 py-2.5 text-xs font-black text-slate-950 shadow-lg shadow-amber-950/40 transition hover:from-amber-300 hover:to-amber-500"
          >
            + Create Production Order
          </button>
        </div>
      ) : viewMode === "list" ? (
        /* LIST VIEW */
        <div className="space-y-3">
          {filteredOrders.map((order) => (
            <div
              key={order.id}
              onClick={() => onSelectOrder(order.id)}
              className="group flex cursor-pointer flex-col justify-between gap-4 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-5 shadow-sm transition-all duration-150 hover:border-amber-500/50 hover:bg-slate-800/70 md:flex-row md:items-center"
            >
              {/* Left Order Info */}
              <div className="flex items-start md:items-center gap-4 min-w-0 flex-1">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700/80 flex items-center justify-center flex-shrink-0 font-mono font-black text-amber-400 text-xs shadow-inner">
                  {order.orderNumber.split("-")[2] || "ORD"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="font-mono text-xl font-black text-amber-400 tracking-tight">{order.orderNumber}</span>
                    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded uppercase ${getStatusBadge(order.status)}`}>
                      {order.status}
                    </span>
                    {dispatchByOrder[String(order.id)] && order.status !== "Delivered" && (
                      <span className="text-[10px] font-extrabold px-2 py-0.5 rounded uppercase bg-sky-500/20 text-sky-300 border border-sky-500/30">
                        Dispatch: {STAGE_LABELS[dispatchByOrder[String(order.id)]]}
                      </span>
                    )}
                    {archivedSet.has(order.id) && (
                      <span className="border border-slate-600/50 bg-slate-700/60 px-2 py-0.5 text-[10px] font-extrabold uppercase text-slate-300 rounded">
                        Archived
                      </span>
                    )}
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${getPriorityBadge(order.priority)}`}>
                      {order.priority}
                    </span>
                    <span className="text-[11px] text-slate-500 font-medium hidden lg:inline-block">
                      • {order.projectType}
                    </span>
                  </div>
                  <h3 className="font-bold text-white text-base truncate group-hover:text-amber-300 transition">
                    {order.title}
                  </h3>
                  <div className="flex items-center gap-4 text-xs text-slate-400 mt-1">
                    <span className="text-sm font-extrabold text-white flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-slate-500" /> {order.customerCompany || order.customerName}
                    </span>
                    <span className={`flex items-center gap-1 ${isOverdue(order) ? "font-bold text-rose-300" : "text-slate-400"}`}>
                      <Calendar className={`h-3.5 w-3.5 ${isOverdue(order) ? "text-rose-400" : "text-slate-500"}`} />
                      Due: {new Date(order.dueDate).toLocaleDateString()}
                      {isOverdue(order) && " · overdue"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Center: Current Machine Station & Progress Bar */}
              <div className="w-full md:w-64 flex-shrink-0 flex flex-col justify-center">
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <span className="text-slate-400 font-medium flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5 text-blue-400" /> Station:
                  </span>
                  <span className="font-bold text-white truncate max-w-[140px]">
                    {order.currentStation ? order.currentStation.machineCode : "Scheduled"}
                  </span>
                </div>
                <div className="w-full bg-slate-950 h-2 rounded-full overflow-hidden border border-slate-800">
                  <div 
                    className={`h-full rounded-full transition-all duration-300 ${
                      order.progressPercent === 100 ? "bg-emerald-500" : "bg-gradient-to-r from-amber-600 to-amber-400"
                    }`} 
                    style={{ width: `${order.progressPercent || 0}%` }} 
                  />
                </div>
                <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 mt-1">
                  <span>{order.completedSteps} of {order.totalSteps} ops done</span>
                  <span className={order.progressPercent === 100 ? "text-emerald-400 font-extrabold" : "text-amber-400"}>
                    {order.progressPercent || 0}%
                  </span>
                </div>
              </div>

              {/* Right Value & Arrow */}
              <div className="flex items-center justify-between md:justify-end gap-6 flex-shrink-0 border-t md:border-0 pt-3 md:pt-0 border-slate-800">
                <div className="text-right">
                  <div className="text-sm font-black text-white font-mono">
                    {order.totalValue != null ? `$${Number(order.totalValue).toLocaleString()}` : <span className="text-slate-600 italic text-[10px]">restricted</span>}
                  </div>
                  <div className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">Total Value</div>
                </div>
                {canArchive && (
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleArchive(order); }}
                    className="w-9 h-9 rounded-xl bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white flex items-center justify-center transition-all flex-shrink-0"
                    title={archivedSet.has(order.id) ? "Restore this order to the active list" : "Archive this order — hides it from the default list (nothing is deleted)"}
                  >
                    <Archive className="w-4 h-4" />
                  </button>
                )}
                <div className="w-9 h-9 rounded-xl bg-slate-800 group-hover:bg-amber-500 group-hover:text-slate-950 text-slate-400 flex items-center justify-center transition-all">
                  <ChevronRight className="w-5 h-5 stroke-[2.5]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* KANBAN BOARD VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pb-8">
          {kanbanColumns.map((col) => {
            const colOrders = filteredOrders.filter(o => o.status === col.status);
            return (
              <div key={col.status} className="flex flex-col bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3.5">
                <div className={`flex items-center justify-between pb-3 mb-3 border-b-2 ${col.color}`}>
                  <span className="font-extrabold text-sm text-white tracking-tight">{col.title}</span>
                  <span className="bg-slate-800 text-slate-200 text-xs font-mono font-bold px-2 py-0.5 rounded">
                    {colOrders.length}
                  </span>
                </div>
                <div className="space-y-3 flex-1 overflow-y-auto max-h-[680px] pr-1">
                  {colOrders.map(order => (
                    <div
                      key={order.id}
                      onClick={() => onSelectOrder(order.id)}
                      className="p-4 bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-amber-500/50 rounded-xl transition cursor-pointer shadow-sm group"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-mono text-base font-black text-amber-400 tracking-tight">{order.orderNumber}</span>
                        <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase ${getPriorityBadge(order.priority)}`}>
                          {order.priority}
                        </span>
                      </div>
                      <h4 className="font-bold text-white text-sm line-clamp-2 group-hover:text-amber-300 transition mb-2">
                        {order.title}
                      </h4>
                      <div className="text-xs text-white font-extrabold mb-3 truncate">
                        {order.customerCompany || order.customerName}
                      </div>
                      {dispatchByOrder[String(order.id)] && order.status !== "Delivered" && (
                        <div className="mb-2">
                          <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded uppercase bg-sky-500/20 text-sky-300 border border-sky-500/30">
                            Dispatch: {STAGE_LABELS[dispatchByOrder[String(order.id)]]}
                          </span>
                        </div>
                      )}
                      
                      {/* Station pill & progress */}
                      <div className="p-2 bg-slate-950/70 rounded-lg border border-slate-800/80 text-[11px] mb-2">
                        <div className="flex items-center justify-between text-slate-300">
                          <span className="text-slate-500">Station:</span>
                          <span className="font-bold text-amber-400">{order.currentStation?.machineCode || "Ready"}</span>
                        </div>
                        <div className="w-full bg-slate-800 h-1 rounded-full mt-1.5 overflow-hidden">
                          <div className="bg-amber-500 h-full rounded-full" style={{ width: `${order.progressPercent}%` }} />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-2 border-t border-slate-800">
                        <span>Due {new Date(order.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                        <span className="font-black text-white font-mono">{order.totalValue != null ? `$${Number(order.totalValue).toLocaleString()}` : "—"}</span>
                      </div>
                    </div>
                  ))}
                  {colOrders.length === 0 && (
                    <div className="py-12 text-center text-slate-600 text-xs font-medium italic">
                      No orders in {col.title}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <NewOrderWizard
        open={showNewModal}
        onClose={() => setShowNewModal(false)}
        onCreated={onRefresh}
        customers={customers}
        templates={templates}
        machines={machines}
        inventoryItems={inventoryItems}
        currentUser={currentUser}
        cloneSeed={cloneSeed}
        onCloneConsumed={onCloneConsumed}
      />
    </div>
  );
}
