"use client";

// ============================================================================
// Warehouse & BOM board — every open order with its requested materials.
// The warehouse supervisor moves each line: Requested -> Prepared -> Delivered,
// optionally choosing which machine the material goes to.
// ============================================================================

import React, { useCallback, useEffect, useState } from "react";
import { PackageCheck, RefreshCw, Send, TriangleAlert, Undo2, Warehouse as WarehouseIcon } from "lucide-react";
import { can } from "@/lib/permissions";

interface Line {
  id: number;
  itemName: string | null;
  itemSku: string | null;
  itemUnit: string | null;
  itemCategory: string | null;
  stockQuantity: number | null;
  quantityUsed: number;
  consumed: boolean;
  released: boolean;
  status: "Requested" | "Prepared" | "Delivered";
  machineId: number | null;
}

interface BoardOrder {
  id: number;
  orderNumber: string;
  title: string;
  status: string;
  priority: string;
  dueDate: string | null;
  customerCompany: string | null;
  materials: Line[];
  machines: { id: number; code: string | null; name: string | null }[];
}

const STATUS_STYLE: Record<Line["status"], string> = {
  Requested: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  Prepared: "bg-sky-500/15 text-sky-300 border-sky-500/40",
  Delivered: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
};

export default function WarehouseView({ currentUser }: { currentUser: any }) {
  const [orders, setOrders] = useState<BoardOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [hideDone, setHideDone] = useState(false);

  const canUpdate =
    can(currentUser?.role, "inventory:write") || can(currentUser?.role, "orders:write");
  const isManager = can(currentUser?.role, "users:manage");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/bom", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load the BOM board");
      setOrders(Array.isArray(data.orders) ? data.orders : []);
    } catch (e: any) {
      setError(e.message || "Failed to load the BOM board");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const setStatus = async (line: Line, status: Line["status"], machineId?: number | null) => {
    setBusyId(line.id);
    try {
      const res = await fetch("/api/bom", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allocationId: line.id, status, machineId: machineId ?? line.machineId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      await load();
    } catch (e: any) {
      setError(e.message || "Failed to update status");
    } finally {
      setBusyId(null);
    }
  };

  const withLines = orders.filter((o) => o.materials.length > 0);
  const visible = hideDone
    ? withLines.map((o) => ({ ...o, materials: o.materials.filter((m) => m.status !== "Delivered") })).filter((o) => o.materials.length > 0)
    : withLines;

  const counts = withLines.reduce(
    (acc, o) => {
      for (const m of o.materials) acc[m.status] += 1;
      return acc;
    },
    { Requested: 0, Prepared: 0, Delivered: 0 } as Record<Line["status"], number>,
  );

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-black text-white">
              <WarehouseIcon className="h-5 w-5 text-amber-400" /> Warehouse &amp; BOM
            </h1>
            <p className="text-xs text-slate-400">
              Materials requested by open orders — prepare them, then send them to the machine.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
              <input type="checkbox" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />
              Hide delivered
            </label>
            <button
              type="button"
              onClick={load}
              className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-950 px-3 py-1.5 text-[11px] font-bold text-slate-300 hover:border-slate-500"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-[11px] font-bold">
          <span className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-amber-300">Requested: {counts.Requested}</span>
          <span className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-sky-300">Prepared: {counts.Prepared}</span>
          <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-emerald-300">Delivered: {counts.Delivered}</span>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
            <TriangleAlert className="h-4 w-4" /> {error}
          </div>
        )}

        {loading ? (
          <div className="py-16 text-center text-sm text-slate-500">Loading the board…</div>
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 py-16 text-center">
            <PackageCheck className="mx-auto h-8 w-8 text-slate-600" />
            <p className="mt-2 text-sm font-bold text-slate-400">Nothing to prepare</p>
            <p className="text-xs text-slate-500">
              BOM lines added on new production orders will appear here.
            </p>
          </div>
        ) : (
          visible.map((order) => (
            <div key={order.id} className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/50">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 bg-slate-950/60 px-4 py-3">
                <div>
                  <span className="font-mono text-xs font-black text-amber-400">{order.orderNumber}</span>
                  <span className="ml-2 text-sm font-bold text-white">{order.title}</span>
                  {order.customerCompany && (
                    <span className="ml-2 text-xs text-slate-400">— {order.customerCompany}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[11px] font-bold">
                  <span className="rounded-lg bg-slate-800 px-2 py-1 text-slate-300">{order.status}</span>
                  <span className="rounded-lg bg-slate-800 px-2 py-1 text-slate-300">
                    Due {order.dueDate ? new Date(order.dueDate).toLocaleDateString() : "—"}
                  </span>
                </div>
              </div>

              <div className="divide-y divide-slate-800/70">
                {order.materials.map((line) => (
                  <div key={line.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-xs font-bold text-white">
                        {line.itemName || `Item #${line.id}`}
                        {line.itemSku && <span className="ml-2 font-mono text-[10px] text-slate-500">{line.itemSku}</span>}
                      </div>
                      <div className="text-[10px] text-slate-500">
                        {line.itemCategory || "Material"}
                        {line.stockQuantity != null && ` · ${line.stockQuantity} ${line.itemUnit || ""} in stock`}
                      </div>
                    </div>

                    <div className="text-center">
                      <div className="font-mono text-sm font-black text-amber-300">
                        {line.quantityUsed}
                        <span className="ml-1 text-[10px] font-bold text-slate-500">{line.itemUnit || "pcs"}</span>
                      </div>
                    </div>

                    {isManager ? (
                      order.machines.length > 0 && (
                        <select
                          value={line.machineId ?? ""}
                          disabled={busyId === line.id}
                          onChange={(e) =>
                            setStatus(line, line.status, e.target.value ? Number(e.target.value) : null)
                          }
                          className="w-40 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-white disabled:opacity-50"
                          title="Re-route this material (Manager only)"
                        >
                          <option value="">— machine —</option>
                          {order.machines.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.code} — {m.name}
                            </option>
                          ))}
                        </select>
                      )
                    ) : line.machineId != null ? (
                      <span
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] font-bold text-slate-300"
                        title="Assigned by the routing sequence — only a Manager can change this"
                      >
                        → {order.machines.find((m) => m.id === line.machineId)?.code || `Machine #${line.machineId}`}
                      </span>
                    ) : null}

                    <span className={`rounded-lg border px-2 py-1 text-[10px] font-black uppercase ${STATUS_STYLE[line.status]}`}>
                      {line.status}
                    </span>

                    {canUpdate && (
                      <div className="flex items-center gap-1.5">
                        {line.status === "Requested" && (
                          <button
                            type="button"
                            disabled={busyId === line.id}
                            onClick={() => setStatus(line, "Prepared")}
                            className="flex items-center gap-1 rounded-lg bg-sky-600 px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-sky-500 disabled:opacity-50"
                          >
                            <PackageCheck className="h-3.5 w-3.5" /> Prepare
                          </button>
                        )}
                        {line.status === "Prepared" && (
                          <button
                            type="button"
                            disabled={busyId === line.id}
                            onClick={() => setStatus(line, "Delivered")}
                            className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            <Send className="h-3.5 w-3.5" /> Send
                          </button>
                        )}
                        {line.status !== "Requested" && (
                          <button
                            type="button"
                            disabled={busyId === line.id}
                            onClick={() => setStatus(line, "Requested")}
                            title="Move back to Requested"
                            className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:text-white disabled:opacity-50"
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
