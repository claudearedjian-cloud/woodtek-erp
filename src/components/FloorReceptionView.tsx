// ============================================================================
// Material Reception board — the Floor Supervisor's landing screen.
// Lists every open order with its BOM delivery progress and gives the
// Floor Supervisor (or Manager) the three reception decisions per order.
// APPROVE stays locked until the warehouse has DELIVERED every line;
// the server enforces the same rule (PUT /api/bom returns 409).
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { PackageCheck, RefreshCw, AlertTriangle, ArrowRight } from "lucide-react";
import { canAssignMachines } from "@/lib/permissions";
import { fulfilmentLabel, preparedQty, sentQty } from "@/lib/bomDelivery";

type Line = {
  id: number;
  itemName?: string | null;
  productionItemName?: string | null;
  itemSku?: string | null;
  quantityUsed: number;
  itemUnit?: string | null;
  status: "Requested" | "Prepared" | "Delivered";
  preparedQty?: number | null;
  deliveredQty?: number | null;
  receivedQty?: number;
  receiptLots?: { id: string; quantity: number; at: string }[];
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
  receivedQuantity?: number;
  requestedQuantity?: number;
  operationProgress?: { position: number; operationName: string; receivedQuantity: number; atQuantity: number; inProgressQuantity: number; completedQuantity: number; requestedQuantity: number }[];
  operations?: OpInfo[];
};

type OpInfo = {
  id: number;
  stepOrder: number;
  operationName: string;
  productionItemName?: string | null;
  status: string;
  receiptLotId?: string | null;
  lotNumber?: number | null;
  quantity?: number | null;
  machineId: number | null;
  machineCode?: string | null;
  machineCategory?: string | null;
  candidates: { id: number; code: string; name: string; status: string }[];
  candidateMachineIds?: number[];
};

function needsReceipt(order: RxOrder): boolean {
  return Number(order.receivedQuantity || 0) < Number(order.requestedQuantity || 0);
}

function isRejected(order: RxOrder): boolean {
  return order.receivedState === "Declined"
    || (order.received === false && Number(order.receivedQuantity || 0) === 0);
}

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
  const [acceptQty, setAcceptQty] = useState<Record<number, string>>({});
  const [receiptBusyId, setReceiptBusyId] = useState<number | null>(null);

  const canApprove =
    !!currentUser &&
    (currentUser.role === "Manager" ||
      currentUser.role === "Floor Supervisor" ||
      currentUser.displayRole === "Floor Supervisor");
  // Machine assignment: Floor Supervisor (or a custom role based on it) + Manager.
  const canAssign = !!currentUser && canAssignMachines(currentUser.role);

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

  const decide = async (orderId: number, state: "Received" | "Not Received" | "Declined", allocationId?: number, quantity?: number) => {
    if (allocationId && receiptBusyId !== null) return;
    if (allocationId) setReceiptBusyId(allocationId);
    setError("");
    try {
      const res = await fetch("/api/bom", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(allocationId && quantity ? { allocationId, quantity, state } : { orderId, state }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Reception update failed.");
        setTimeout(() => setError(""), 6000);
        return;
      }
      setNotice(
        state === "Received"
          ? `Accepted ${quantity} unit(s) into a new production lot.`
          : state === "Declined"
            ? "Reception DECLINED."
            : "Marked as NOT RECEIVED.",
      );
      setTimeout(() => setNotice(""), 4000);
      if (allocationId) setAcceptQty((current) => { const next = { ...current }; delete next[allocationId]; return next; });
      await load();
    } catch {
      /* ignore */
    } finally {
      if (allocationId) setReceiptBusyId(null);
    }
  };

  // Effective offer set for a row: the candidate overlay when present,
  // otherwise the assigned machine; an unassigned step starts empty.
  const selectedCandidateIds = (op: OpInfo): number[] => {
    if (Array.isArray(op.candidateMachineIds) && op.candidateMachineIds.length > 0) {
      return op.candidateMachineIds.map(Number).filter((id) => Number.isInteger(id) && id > 0);
    }
    return op.machineId ? [Number(op.machineId)] : [];
  };

  // Multi-station offer: toggling a station updates the FULL candidate set
  // (same mechanism as the order workflow). The first valid Start claims one
  // station; the others lose the job and see it greyed on their station.
  const toggleCandidateStation = async (opId: number, nextIds: number[]) => {
    setError("");
    if (nextIds.length === 0) {
      setError("Keep at least one candidate station selected.");
      setTimeout(() => setError(""), 6000);
      return;
    }
    try {
      const res = await fetch(`/api/operations/${opId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidateMachineIds: nextIds }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Machine assignment failed.");
        setTimeout(() => setError(""), 6000);
        return;
      }
      setNotice(
        nextIds.length > 1
          ? `Offered to ${nextIds.length} stations — first Start claims one.`
          : "Machine assigned.",
      );
      setTimeout(() => setNotice(""), 4000);
      await load();
    } catch {
      /* ignore */
    }
  };

  const stats = useMemo(() => {
    const awaiting = orders.filter(needsReceipt).length;
    const received = orders.filter((o) => o.received === true).length;
    const rejected = orders.filter(isRejected).length;
    return { awaiting, received, rejected };
  }, [orders]);

  const shown = orders.filter((o) => {
    if (filter === "decision") return needsReceipt(o);
    if (filter === "received") return o.received === true;
    if (filter === "rejected") return isRejected(o);
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
            Accept any physically counted quantity that the warehouse has sent; each acceptance opens an independent production lot.
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

      {/* Compact status filter */}
      <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-400">Show
        <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filter floor reception orders" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-xs font-bold text-slate-200 focus:border-amber-500 focus:outline-none">
          <option value="all">All orders</option><option value="decision">Needs decision</option><option value="received">Approved</option><option value="rejected">Not received / declined</option>
        </select>
      </label>

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
                    {o.receivedQuantity && o.receivedQuantity > 0 && o.received !== true && (
                      <span className="rounded-lg border border-teal-500/40 bg-teal-500/10 px-2 py-0.5 text-[10px] font-black text-teal-300">
                        PARTIAL · {o.receivedQuantity}/{o.requestedQuantity} ACCEPTED
                      </span>
                    )}
                    {o.received === false && o.receivedQuantity === 0 && o.receivedState !== "Declined" && (
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
                    <span>Warehouse delivery and accepted receipts</span>
                    <span className={Number(o.receivedQuantity || 0) >= Number(o.requestedQuantity || 0) ? "text-emerald-300" : "text-sky-300"}>
                      {o.receivedQuantity || 0}/{o.requestedQuantity || 0} received · {delivered}/{lines.length} lines fully sent
                    </span>
                  </div>
                  <div className="mt-2 space-y-1">
                    {lines.map((l) => {
                      const available = Math.max(0, sentQty(l) - Number(l.receivedQty || 0));
                      const qty = Number(acceptQty[l.id] ?? String(available));
                      return (
                        <div key={l.id} className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/50 p-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="min-w-0 flex-1 truncate font-bold text-slate-200">
                              {l.productionItemName ? `${l.productionItemName} · ` : ""}{l.quantityUsed} {l.itemUnit || "pcs"} — {l.itemName || l.itemSku}
                            </span>
                            <span className={`shrink-0 rounded-md border px-2 py-1 text-[10px] font-black uppercase ${
                              fulfilmentLabel(l) === "Delivered"
                                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                                : fulfilmentLabel(l).includes("sent") || fulfilmentLabel(l) === "Partially delivered"
                                  ? "border-teal-500/40 bg-teal-500/10 text-teal-300"
                                  : fulfilmentLabel(l).includes("prepared") || fulfilmentLabel(l) === "Prepared"
                                    ? "border-sky-500/40 bg-sky-500/10 text-sky-300"
                                    : "border-amber-500/40 bg-amber-500/10 text-amber-300"
                            }`}>
                              {fulfilmentLabel(l)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-400">
                            <span>Prepared {preparedQty(l)}/{l.quantityUsed || 0}</span>
                            <span>·</span>
                            <span>Sent {sentQty(l)}/{l.quantityUsed || 0}</span>
                            <span>·</span>
                            <span className="text-emerald-300">Accepted {l.receivedQty || 0}/{l.quantityUsed || 0}</span>
                          </div>
                          {canApprove && (
                            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2">
                              <span className="text-[11px] font-black text-emerald-200">Approve a received quantity as a separate production lot:</span>
                              <input aria-label={`Quantity accepted for ${l.itemName || l.itemSku || "material"}`} type="number" min="1" max={available} value={acceptQty[l.id] ?? String(available || "")} onChange={(event) => setAcceptQty((current) => ({ ...current, [l.id]: event.target.value }))} className="w-20 rounded-md border border-slate-700 bg-slate-900 px-2 py-1.5 text-center text-xs font-black text-white" />
                              <button type="button" disabled={receiptBusyId !== null || !available || !Number.isInteger(qty) || qty < 1 || qty > available} onClick={() => decide(o.id, "Received", l.id, qty)} title={`Release ${qty || 0} accepted unit(s) to their own first production operation`} className="rounded-md border border-emerald-500/50 bg-emerald-500/15 px-3 py-1.5 text-[10px] font-black uppercase text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40">
                                Approve {Number.isInteger(qty) && qty > 0 ? qty : 0} as lot
                              </button>
                              {!available && <span className="text-[10px] text-slate-500">No unaccepted sent quantity</span>}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-1.5">
                            {(l.receiptLots ?? []).map((lot, index) => (
                              <span key={lot.id} className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1 text-[10px] font-black text-violet-200" title={`Accepted ${new Date(lot.at).toLocaleString()}`}>
                                Lot {index + 1} · {lot.quantity}
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {lines.length === 0 && (
                      <div className="text-[11px] text-slate-500 italic">No materials requested for this order.</div>
                    )}
                  </div>
                  {!allDelivered && lines.length > 0 && (
                    <div className="mt-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1.5 text-[10px] font-black text-sky-300">
                      Accept only the quantity physically counted. Unaccepted sent units stay out of production.
                    </div>
                  )}
                </div>

                {(o.operationProgress ?? []).length > 0 && (
                  <div className="rounded-xl border border-violet-500/30 bg-violet-500/5 p-3">
                    <div className="mb-2 text-[11px] font-black uppercase tracking-wider text-violet-200">Production lot progress</div>
                    <div className="flex flex-wrap gap-2">
                      {o.operationProgress!.map((step) => (
                        <span key={`${step.position}-${step.operationName}`} className="rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 py-1.5 text-[10px] font-bold text-slate-200">
                          {step.operationName}: <b className="text-sky-300">{step.atQuantity}/{step.requestedQuantity} at this station</b> · <b className="text-emerald-300">{step.completedQuantity}/{step.requestedQuantity} processed</b>
                          {step.inProgressQuantity > 0 && <span className="text-amber-300"> · {step.inProgressQuantity} in progress</span>}
                          {step.receivedQuantity < step.requestedQuantity && <span className="text-slate-500"> · {step.requestedQuantity - step.receivedQuantity} not yet received</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* machine assignment — Floor Supervisor's call, after approval */}
                {canAssign && (o.operations ?? []).some((op) => (op.candidates ?? []).length >= 1 && (op.status === "Pending" || op.status === "Ready")) && (
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                    <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-slate-400">
                      <span>Machine assignment — your decision</span>
                    </div>
                    <div className="mt-2 space-y-2">
                      {(o.operations ?? [])
                        .filter((op) => (op.candidates ?? []).length >= 1 && (op.status === "Pending" || op.status === "Ready"))
                        .map((op) => (
                          <div key={op.id} className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-bold text-slate-200 truncate">
                              {op.productionItemName ? `${op.productionItemName} · ` : ""}#{op.stepOrder} {op.operationName}
                              <span className="text-slate-500"> · now: {op.machineCode || "—"}</span>
                            </span>
                            {op.receiptLotId || o.received === true ? (
                              <span className="flex flex-wrap items-center gap-1.5">
                                {op.candidates.map((c) => {
                                  const selected = selectedCandidateIds(op).includes(c.id);
                                  return (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => {
                                        const set = selectedCandidateIds(op);
                                        const next = selected
                                          ? set.filter((id) => id !== c.id)
                                          : [...set, c.id];
                                        void toggleCandidateStation(op.id, next);
                                      }}
                                      title={
                                        selected
                                          ? "Remove this candidate station"
                                          : "Offer this step to this station too"
                                      }
                                      className={`rounded-lg border px-2 py-1 text-[10px] font-black ${
                                        selected
                                          ? "border-emerald-500 bg-emerald-500/20 text-emerald-300"
                                          : "border-slate-700 bg-slate-900 text-slate-300 hover:border-amber-500 hover:text-amber-300"
                                      }`}
                                    >
                                      {c.code}
                                    </button>
                                  );
                                })}
                                {selectedCandidateIds(op).length > 1 && (
                                  <span className="text-[9px] font-black uppercase tracking-wide text-amber-300">
                                    First Start claims one
                                  </span>
                                )}
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
                {canApprove && lines.length > 0 && o.received !== true && Number(o.receivedQuantity || 0) === 0 && (
                  <div className="grid grid-cols-2 gap-2">
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
