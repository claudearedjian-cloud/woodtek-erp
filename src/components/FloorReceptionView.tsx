// ============================================================================
// Material Reception board — the Floor Supervisor's landing screen.
// Lists every open order with its BOM delivery progress and gives the
// Floor Supervisor (or Manager) the three reception decisions per order.
// APPROVE stays locked until the warehouse has DELIVERED every line;
// the server enforces the same rule (PUT /api/bom returns 409).
// ============================================================================
import React, { useEffect, useMemo, useState } from "react";
import { PackageCheck, RefreshCw, AlertTriangle, ArrowRight } from "lucide-react";

type Line = {
  id: number;
  itemName?: string | null;
  itemSku?: string | null;
  quantityUsed?: number;
  itemUnit?: string | null;
  status?: string;
};

type RxOrder = {
  id: number;
  orderNumber: string;
  title: string;
  status: string;
  dueDate: string;
  customerCompany?: string | null;
  customerName?: string | null;
  materials: Line[];
  received: boolean | null;
  receivedState?: string | null;
  operations?: OpInfo[];
};

type OpInfo = {
  id: number;
  stepOrder: number;
  operationName: string;
  status: string;
  machineId: number | null;
  machineCode?: string | null;
  candidates: { id: number; code: string; name: string; status: string }[];
};

export default function FloorReceptionView({
  currentUser,
  onSelectOrder,
}: {
  currentUser: any;
  onSelectOrder: (id: number) => void;
}) {
  const [orders, setOrders] = useState<RxOrder[]>([]);
  const [filter, setFilter] = useState<"all" | "decision" | "received" | "rejected">("all");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const canApprove =
    !!currentUser &&
    (currentUser.role === "Manager" ||
      currentUser.role === "Floor Supervisor" ||
      currentUser.displayRole === "Floor Supervisor");

  const load = async () => {
    try {
      const r = await fetch("/api/bom", { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setOrders(Array.isArray(d.orders) ? d.orders : []);
    } catch {
      /* best effort */
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  const decide = async (orderId: number, state: "Received" | "Not Received" | "Declined") => {
    setError("");
    try {
      const res = await fetch("/api/bom", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, state }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Reception update failed.");
        setTimeout(() => setError(""), 6000);
        return;
      }
      setNotice(
        state === "Received"
          ? "Reception APPROVED."
          : state === "Declined"
            ? "Reception DECLINED."
            : "Marked as NOT RECEIVED.",
      );
      setTimeout(() => setNotice(""), 4000);
      await load();
    } catch {
      /* ignore */
    }
  };

  const assignMachine = async (opId: number, machineId: number) => {
    setError("");
    try {
      const res = await fetch(`/api/operations/${opId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ machineId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Machine assignment failed.");
        setTimeout(() => setError(""), 6000);
        return;
      }
      setNotice("Machine assigned.");
      setTimeout(() => setNotice(""), 4000);
      await load();
    } catch {
      /* ignore */
    }
  };

  const stats = useMemo(() => {
    const awaiting = orders.filter((o) => o.received == null).length;
    const received = orders.filter((o) => o.received === true).length;
    const rejected = orders.filter((o) => o.received === false).length;
    return { awaiting, received, rejected };
  }, [orders]);

  const shown = orders.filter((o) => {
    if (filter === "decision") return o.received == null;
    if (filter === "received") return o.received === true;
    if (filter === "rejected") return o.received === false;
    return true;
  });

  return (
    <div className="p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-white flex items-center gap-2">
            <PackageCheck className="w-6 h-6 text-emerald-400" /> Material Reception
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Approve reception only after the warehouse has prepared &amp; delivered every requested line.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white hover:border-slate-500"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-center">
          <div className="text-2xl font-black text-amber-300">{stats.awaiting}</div>
          <div className="text-[10px] font-black uppercase tracking-wider text-amber-200/70">Awaiting decision</div>
        </div>
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-center">
          <div className="text-2xl font-black text-emerald-300">{stats.received}</div>
          <div className="text-[10px] font-black uppercase tracking-wider text-emerald-200/70">Approved</div>
        </div>
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-center">
          <div className="text-2xl font-black text-rose-300">{stats.rejected}</div>
          <div className="text-[10px] font-black uppercase tracking-wider text-rose-200/70">Not received / declined</div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        {(
          [
            ["all", "All orders"],
            ["decision", "Needs decision"],
            ["received", "Approved"],
            ["rejected", "Not received / declined"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setFilter(key)}
            className={`rounded-xl px-3 py-1.5 text-[11px] font-black uppercase tracking-wider border ${
              filter === key
                ? "border-amber-500 bg-amber-500 text-slate-950"
                : "border-slate-700 bg-slate-900 text-slate-400 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Banners */}
      {notice && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-black text-emerald-300">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm font-black text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Order cards */}
      {shown.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-10 text-center text-sm text-slate-500">
          No orders in this filter.
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {shown.map((o) => {
            const lines = o.materials ?? [];
            const delivered = lines.filter((l) => l.status === "Delivered").length;
            const allDelivered = lines.length > 0 && delivered === lines.length;
            return (
              <div key={o.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 space-y-3">
                {/* identity */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectOrder(o.id)}
                    className="flex items-center gap-2 text-left group"
                    title="Open order"
                  >
                    <span className="font-mono text-xl font-black text-amber-400 tracking-tight group-hover:text-amber-300">
                      {o.orderNumber}
                    </span>
                    <ArrowRight className="w-4 h-4 text-slate-600 group-hover:text-amber-300" />
                  </button>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-extrabold px-2 py-0.5 rounded uppercase bg-slate-800 text-slate-300">
                      {o.status}
                    </span>
                    {o.received === true && (
                      <span className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-black text-emerald-300">
                        RECEIVED ✓
                      </span>
                    )}
                    {o.received === false && o.receivedState === "Declined" && (
                      <span className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 text-[10px] font-black text-rose-300">
                        DECLINED ✗
                      </span>
                    )}
                    {o.received === false && o.receivedState !== "Declined" && (
                      <span className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] font-black text-amber-300">
                        NOT RECEIVED ✗
                      </span>
                    )}
                    {o.received == null && (
                      <span className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-black text-sky-300">
                        AWAITING DECISION
                      </span>
                    )}
                  </div>
                </div>
                <div className="text-base font-extrabold text-white truncate">{o.title}</div>
                <div className="text-base font-black text-amber-300 truncate">
                  Client: {o.customerCompany || o.customerName || "—"}
                </div>

                {/* delivery progress */}
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                  <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-slate-400">
                    <span>Warehouse delivery</span>
                    <span className={allDelivered ? "text-emerald-300" : "text-sky-300"}>
                      {delivered}/{lines.length} delivered
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {lines.map((l) => (
                      <div key={l.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate font-bold text-slate-200">
                          {l.quantityUsed} {l.itemUnit || "pcs"} — {l.itemName || l.itemSku}
                        </span>
                        <span
                          className={`shrink-0 rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase ${
                            l.status === "Delivered"
                              ? "bg-emerald-500/10 text-emerald-300"
                              : l.status === "Prepared"
                                ? "bg-sky-500/10 text-sky-300"
                                : "bg-amber-500/10 text-amber-300"
                          }`}
                        >
                          {l.status || "Requested"}
                        </span>
                      </div>
                    ))}
                    {lines.length === 0 && (
                      <div className="text-[11px] text-slate-500 italic">No materials requested for this order.</div>
                    )}
                  </div>
                  {!allDelivered && lines.length > 0 && (
                    <div className="mt-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-[10px] font-black text-sky-300">
                      🚚 APPROVE unlocks when the warehouse has DELIVERED every line.
                    </div>
                  )}
                </div>

                {/* machine assignment — Floor Supervisor's call, after approval */}
                {canApprove && (o.operations ?? []).some((op) => (op.candidates ?? []).length > 1 && (op.status === "Pending" || op.status === "Ready")) && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                    <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-slate-400">
                      <span>Machine assignment — your decision</span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {(o.operations ?? [])
                        .filter((op) => (op.candidates ?? []).length > 1 && (op.status === "Pending" || op.status === "Ready"))
                        .map((op) => (
                          <div key={op.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-bold text-slate-200 truncate">
                              #{op.stepOrder} {op.operationName}
                              <span className="text-slate-500"> · now: {op.machineCode || "—"}</span>
                            </span>
                            {o.received === true ? (
                              <span className="flex flex-wrap gap-1.5">
                                {op.candidates.map((c) => (
                                  <button
                                    key={c.id}
                                    type="button"
                                    disabled={c.id === op.machineId}
                                    onClick={() => assignMachine(op.id, c.id)}
                                    className={`rounded-lg border px-2 py-1 text-[10px] font-black ${
                                      c.id === op.machineId
                                        ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                                        : "border-slate-700 bg-slate-900 text-slate-300 hover:border-amber-500 hover:text-amber-300"
                                    }`}
                                  >
                                    {c.code}
                                  </button>
                                ))}
                              </span>
                            ) : (
                              <span className="text-[10px] font-black text-sky-300">🔒 after approval</span>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                {/* decisions — hidden once a reception is approved */}
                {canApprove && lines.length > 0 && o.received !== true && (
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={!allDelivered}
                      title={allDelivered ? "Approve material reception" : "Waiting for warehouse delivery"}
                      onClick={() => decide(o.id, "Received")}
                      className="rounded-xl border-2 border-emerald-600 bg-emerald-600/20 px-2 py-2.5 text-[11px] font-black text-emerald-300 hover:bg-emerald-600/40 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ✓ APPROVE
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(o.id, "Not Received")}
                      className="rounded-xl border-2 border-amber-600 bg-amber-600/10 px-2 py-2.5 text-[11px] font-black text-amber-300 hover:bg-amber-600/30"
                    >
                      ✗ NOT RECEIVED
                    </button>
                    <button
                      type="button"
                      onClick={() => decide(o.id, "Declined")}
                      className="rounded-xl border-2 border-rose-600 bg-rose-600/10 px-2 py-2.5 text-[11px] font-black text-rose-300 hover:bg-rose-600/30"
                    >
                      ⛔ DECLINE
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
