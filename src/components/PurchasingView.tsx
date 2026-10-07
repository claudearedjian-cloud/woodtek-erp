"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, ArrowRight, CheckCircle2, CircleDollarSign, ClipboardList, FileText, PackageCheck,
  Plus, RefreshCw, Search, Truck, Users, X,
} from "lucide-react";
import { newReceiptRequestKey, suggestedReorderQty, type SupplierInput } from "@/lib/purchasing";
import SupplierBillsView from "@/components/SupplierBillsView";

type Supplier = SupplierInput & {
  id: number; active: boolean; awaitingOrders: number; awaitingQuantity: number;
  awaitingValue: string | null;
};
type StockItem = {
  id: number; sku: string; name: string; unit: string;
  stockQuantity: number; reorderLevel: number; onOrder: number;
  unitCost: string | null; lastSupplierId: number | null;
};
type PurchaseLine = {
  id: number; itemId: number | null; itemSku: string; itemName: string;
  itemUnit: string; quantity: number; receivedQuantity: number; remainingQuantity: number;
  unitPrice: string | null; lineTotal: string | null;
};
type Receipt = {
  id: number; number: string; deliveryRef: string; notes: string; receivedAt: string;
  lines: Array<{ poLineId: number; itemName: string; quantity: number }>;
};
type PurchaseOrder = {
  id: number; number: string; supplierId: number; supplierName: string;
  createdAt: string; expectedAt: string | null; status: string; notes: string;
  lines: PurchaseLine[]; receipts: Receipt[];
  orderedQty: number; receivedQty: number; awaitingQty: number;
  total: string | null; awaitingValue: string | null;
};
type Board = {
  suppliers: Supplier[]; orders: PurchaseOrder[]; items: StockItem[]; canSeeMoney: boolean;
};
type PoDraftLine = { itemId: string; quantity: string; unitPrice: string };
type PoDraft = { supplierId: string; expectedAt: string; notes: string; lines: PoDraftLine[] };

const emptySupplier = (): SupplierInput => ({ name: "", contactName: "", phone: "", email: "", address: "", notes: "" });
const emptyPo = (): PoDraft => ({ supplierId: "", expectedAt: "", notes: "", lines: [{ itemId: "", quantity: "1", unitPrice: "0.00" }] });
const money = (amount: string | null) => amount === null ? "Restricted" : `$${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateLabel = (date: string | null) => date ? date.slice(0, 10) : "Not set";

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, {
    method, headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body), cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="modal-backdrop fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={title} className="my-auto max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-7">
        <div className="mb-5 flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <h2 className="text-lg font-black text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>, document.body,
  );
}

const inputClass = "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-400";
const primaryClass = "rounded-xl bg-amber-500 px-4 py-2 text-sm font-black text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40";
const secondaryClass = "rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:border-amber-500/60 hover:text-white disabled:opacity-50";

export default function PurchasingView({
  initialItemId, onInitialItemConsumed, onStockChanged,
}: {
  initialItemId?: number | null;
  onInitialItemConsumed?: () => void;
  onStockChanged?: () => void | Promise<void>;
}) {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [panel, setPanel] = useState<"orders" | "payables">("orders");
  const [showHistory, setShowHistory] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [supplierForm, setSupplierForm] = useState<(SupplierInput & { id?: number }) | null>(null);
  const [poForm, setPoForm] = useState<PoDraft | null>(null);
  const [reorderItem, setReorderItem] = useState<StockItem | null>(null);
  const [receiptOrder, setReceiptOrder] = useState<PurchaseOrder | null>(null);
  const [receiptQuantities, setReceiptQuantities] = useState<Record<number, string>>({});
  const [receiptRef, setReceiptRef] = useState("");
  const [receiptNotes, setReceiptNotes] = useState("");
  const [receiptKey, setReceiptKey] = useState("");

  const refresh = async () => {
    try {
      const res = await fetch("/api/purchasing", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load purchasing.");
      setBoard(data as Board);
      setError("");
    } catch (cause) {
      setBoard(null); // don't retain a previous user's financial data after a 403
      setError(cause instanceof Error ? cause.message : "Could not load purchasing.");
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void refresh(); }, []);

  useEffect(() => {
    if (!board || initialItemId == null) return;
    const item = board.items.find((it) => it.id === initialItemId);
    onInitialItemConsumed?.();
    if (!item) { setNotice("The reorder item is no longer in stock. Refresh the alerts."); return; }
    const qty = suggestedReorderQty(item.stockQuantity, item.reorderLevel, item.onOrder);
    setReorderItem(item);
    setPoForm({
      supplierId: String(item.lastSupplierId ?? ""), expectedAt: "", notes: "",
      lines: [{ itemId: String(item.id), quantity: String(qty || 1), unitPrice: item.unitCost ?? "0.00" }],
    });
    setNotice("");
  }, [board, initialItemId, onInitialItemConsumed]);

  const openNewOrder = () => { setReorderItem(null); setPoForm(emptyPo()); setError(""); };
  const patchLine = (index: number, change: Partial<PoDraftLine>) => {
    setPoForm((form) => form ? { ...form, lines: form.lines.map((l, i) => i === index ? { ...l, ...change } : l) } : null);
  };
  const chooseItem = (index: number, itemId: string) => {
    const item = board?.items.find((i) => String(i.id) === itemId);
    patchLine(index, { itemId, unitPrice: board?.canSeeMoney ? item?.unitCost ?? "0.00" : "0.00" });
  };

  const saveSupplier = async (event: FormEvent) => {
    event.preventDefault();
    if (!supplierForm || busy) return;
    setBusy(true); setError("");
    try {
      const data = await send(supplierForm.id ? `/api/purchasing/suppliers/${supplierForm.id}` : "/api/purchasing/suppliers", supplierForm.id ? "PATCH" : "POST", supplierForm);
      setSupplierId(data.id);
      setSupplierForm(null);
      setNotice(`Supplier ${data.name} saved.`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save supplier."); }
    finally { setBusy(false); }
  };

  const toggleSupplier = async (supplier: Supplier) => {
    if (busy || !window.confirm(`${supplier.active ? "Archive" : "Reactivate"} ${supplier.name}? Historic POs and receipts are kept.`)) return;
    setBusy(true); setError("");
    try {
      await send(`/api/purchasing/suppliers/${supplier.id}`, "PATCH", { ...supplier, active: !supplier.active });
      setNotice(`${supplier.name} ${supplier.active ? "archived" : "reactivated"}.`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update supplier."); }
    finally { setBusy(false); }
  };

  const savePo = async (event: FormEvent) => {
    event.preventDefault();
    if (!poForm || busy) return;
    setBusy(true); setError("");
    try {
      const data = await send("/api/purchasing/orders", "POST", {
        supplierId: Number(poForm.supplierId), expectedAt: poForm.expectedAt || null,
        notes: poForm.notes,
        lines: poForm.lines.map((line) => ({
          itemId: Number(line.itemId), quantity: Number(line.quantity),
          unitPrice: board?.canSeeMoney ? line.unitPrice : "0.00",
        })),
      });
      setPoForm(null); setReorderItem(null); setExpandedId(data.id); setShowHistory(false);
      setSupplierId(null);
      setNotice(`${data.number} created. Record a goods receipt when stock arrives.`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not create purchase order."); }
    finally { setBusy(false); }
  };

  const openReceipt = (order: PurchaseOrder) => {
    try {
      const key = newReceiptRequestKey(); // retained unchanged on network error/retry
      setReceiptOrder(order); setReceiptRef(""); setReceiptNotes(""); setError("");
      setReceiptQuantities(Object.fromEntries(order.lines.map((line) => [line.id, "0"])));
      setReceiptKey(key);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start goods receipt."); }
  };
  const saveReceipt = async (event: FormEvent) => {
    event.preventDefault();
    if (!receiptOrder || busy) return;
    const lines = receiptOrder.lines.map((line) => ({
      poLineId: line.id, quantity: Number(receiptQuantities[line.id] || 0),
    })).filter((line) => line.quantity !== 0);
    if (!lines.length) { setError("Enter the quantity actually delivered on at least one line."); return; }
    setBusy(true); setError("");
    try {
      const result = await send(`/api/purchasing/orders/${receiptOrder.id}/receipts`, "POST", {
        requestKey: receiptKey, deliveryRef: receiptRef, notes: receiptNotes, lines,
      });
      setReceiptOrder(null);
      setNotice(`${result.number} ${result.replayed ? "already recorded — stock was not added twice." : "posted — stock increased for each received line."}`);
      await refresh();
      if (!result.replayed) await onStockChanged?.();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not receive goods."); }
    finally { setBusy(false); }
  };

  const finishPo = async (order: PurchaseOrder, status: "Closed" | "Cancelled") => {
    if (busy || !window.confirm(status === "Cancelled"
      ? `Cancel ${order.number}? Only POs with no goods received can be cancelled.`
      : `Close ${order.number} with ${order.awaitingQty} units still undelivered? Future receipts will be blocked.`)) return;
    setBusy(true); setError("");
    try {
      await send(`/api/purchasing/orders/${order.id}`, "PATCH", { status });
      setNotice(`${order.number} ${status.toLowerCase()}. Historic receipts and stock are unchanged.`);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update purchase order."); }
    finally { setBusy(false); }
  };

  const suppliers = board?.suppliers ?? [];
  const orders = board?.orders ?? [];
  const activeSuppliers = suppliers.filter((s) => s.active).length;
  const openOrders = orders.filter((o) => o.status === "Open" && o.awaitingQty > 0);
  const waitingUnits = openOrders.reduce((total, o) => total + o.awaitingQty, 0);
  const visibleOrders = orders.filter((o) => (
    (supplierId === null || o.supplierId === supplierId)
    && (showHistory || o.status === "Open")
    && (!search || [o.number, o.supplierName, ...o.lines.map((l) => `${l.itemSku} ${l.itemName}`)]
      .some((value) => value.toLowerCase().includes(search.toLowerCase().trim())))
  ));
  const activeSupplier = suppliers.find((s) => s.id === supplierId);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 pb-16 sm:p-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-amber-400"><Truck className="h-4 w-4" /> Supply chain</div>
          <h1 className="text-2xl font-black tracking-tight text-white sm:text-3xl">Purchasing &amp; Suppliers</h1>
          <p className="mt-1 text-sm text-slate-400">Manage suppliers, material orders, goods receipts and — with a Money grant — supplier bills and payments.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={secondaryClass} onClick={() => { setLoading(true); void refresh(); }} disabled={loading}><RefreshCw className="mr-1 inline h-4 w-4" /> Refresh</button>
          <button className={secondaryClass} onClick={() => { setSupplierForm(emptySupplier()); setError(""); }}><Plus className="mr-1 inline h-4 w-4" /> Supplier</button>
          <button className={primaryClass} onClick={openNewOrder}><Plus className="mr-1 inline h-4 w-4" /> New PO</button>
        </div>
      </header>

      {notice && <div role="status" className="flex items-start justify-between gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-300"><span><CheckCircle2 className="mr-2 inline h-4 w-4" />{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice("")}><X className="h-4 w-4" /></button></div>}
      {error && <div role="alert" className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-300"><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</div>}

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Awaiting delivery", value: `${waitingUnits.toLocaleString()} units`, sub: `${openOrders.length} open PO${openOrders.length === 1 ? "" : "s"}`, Icon: Truck },
          { label: "Suppliers", value: String(activeSuppliers), sub: "active records", Icon: Users },
          { label: "Goods receipts", value: String(orders.reduce((sum, o) => sum + o.receipts.length, 0)), sub: "posted into stock", Icon: PackageCheck },
        ].map(({ label, value, sub, Icon }) => (
          <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
            <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wide text-slate-400">{label}<Icon className="h-4 w-4 text-amber-400" /></div>
            <div className="mt-2 text-2xl font-black text-white">{value}</div>
            <div className="text-xs text-slate-500">{sub}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-900/60 p-2" role="tablist" aria-label="Purchasing workspace">
        <button role="tab" aria-selected={panel === "orders"} className={`rounded-lg px-4 py-2 text-sm font-black transition ${panel === "orders" ? "bg-amber-500 text-slate-950" : "text-slate-300 hover:bg-slate-800"}`} onClick={() => setPanel("orders")}><Truck className="mr-2 inline h-4 w-4" />Deliveries &amp; purchase orders</button>
        {board?.canSeeMoney && <button role="tab" aria-selected={panel === "payables"} className={`rounded-lg px-4 py-2 text-sm font-black transition ${panel === "payables" ? "bg-emerald-400 text-slate-950" : "text-slate-300 hover:bg-slate-800"}`} onClick={() => setPanel("payables")}><CircleDollarSign className="mr-2 inline h-4 w-4" />Supplier bills &amp; A/P</button>}
        {!board?.canSeeMoney && board && <span className="self-center px-2 text-[11px] text-slate-500"><FileText className="mr-1 inline h-3.5 w-3.5" />Supplier bills and payments require an Invoicing &amp; Money grant.</span>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[290px_1fr]">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="font-black text-white">Suppliers</h2><span className="text-xs text-slate-500">{suppliers.length}</span></div>
          <button className={`mb-2 w-full rounded-xl p-3 text-left text-sm font-bold ${supplierId === null ? "bg-amber-500 text-slate-950" : "bg-slate-950 text-slate-300 hover:bg-slate-800"}`} onClick={() => setSupplierId(null)}>All suppliers <span className="float-right">{waitingUnits} due</span></button>
          <div className="max-h-[500px] space-y-1 overflow-y-auto pr-1">
            {suppliers.map((supplier) => (
              <div key={supplier.id} className={`rounded-xl border p-2.5 ${supplierId === supplier.id ? "border-amber-500/70 bg-amber-500/10" : "border-transparent bg-slate-950/60"}`}>
                <button onClick={() => { setSupplierId(supplier.id); setShowHistory(false); }} className="w-full text-left">
                  <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-bold text-slate-100">{supplier.name}</span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-500" /></div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400"><span>{supplier.awaitingOrders} PO · {supplier.awaitingQuantity} awaiting</span>{!supplier.active && <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px]">Archived</span>}</div>
                  {supplier.awaitingValue !== null && supplier.awaitingQuantity > 0 && <div className="mt-1 text-[11px] font-bold text-amber-300">{money(supplier.awaitingValue)} undelivered</div>}
                </button>
                {supplierId === supplier.id && <div className="mt-2 flex gap-2 border-t border-slate-800 pt-2">
                  <button className="text-[11px] font-bold text-amber-300 hover:text-amber-200" onClick={() => { setSupplierForm(supplier); setError(""); }}>Edit record</button>
                  <button className="text-[11px] font-bold text-slate-400 hover:text-white" onClick={() => void toggleSupplier(supplier)}>{supplier.active ? "Archive" : "Reactivate"}</button>
                </div>}
              </div>
            ))}
            {!loading && suppliers.length === 0 && <p className="p-3 text-xs text-slate-400">No suppliers yet. Add one to start buying materials.</p>}
          </div>
          {activeSupplier && <div className="mt-4 space-y-1 border-t border-slate-800 pt-3 text-xs text-slate-400">
            {activeSupplier.contactName && <div>Contact: <span className="text-slate-200">{activeSupplier.contactName}</span></div>}
            {activeSupplier.phone && <div>Phone: <span className="text-slate-200">{activeSupplier.phone}</span></div>}
            {activeSupplier.email && <div>Email: <span className="text-slate-200">{activeSupplier.email}</span></div>}
            {activeSupplier.address && <div className="break-words">Address: {activeSupplier.address}</div>}
            {activeSupplier.notes && <div className="break-words">Notes: {activeSupplier.notes}</div>}
          </div>}
        </section>

        {(panel === "orders" || !board?.canSeeMoney) && <section className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div><h2 className="text-lg font-black text-white">{activeSupplier ? `${activeSupplier.name} · ` : ""}Purchase orders</h2><p className="text-xs text-slate-400">{showHistory ? "All POs and receipt history" : "Open POs awaiting goods"}</p></div>
            <div className="flex flex-wrap gap-2"><button className={secondaryClass} onClick={() => setShowHistory((v) => !v)}>{showHistory ? "Open only" : "Include history"}</button></div>
          </div>
          <div className="relative mb-4"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><input aria-label="Search purchase orders" placeholder="Search PO, supplier, SKU or material" className={`${inputClass} pl-9`} value={search} onChange={(e) => setSearch(e.target.value)} /></div>
          {loading && <div className="rounded-xl border border-dashed border-slate-700 p-9 text-center text-sm text-slate-400">Loading purchasing records…</div>}
          {!loading && board && visibleOrders.length === 0 && <div className="rounded-xl border border-dashed border-slate-700 p-9 text-center text-sm text-slate-400">{showHistory ? "No purchase orders match this filter." : "No deliveries are currently outstanding for this supplier."}</div>}
          <div className="space-y-3">
            {visibleOrders.map((order) => (
              <article key={order.id} className="rounded-xl border border-slate-700/80 bg-slate-950/60">
                <button onClick={() => setExpandedId((id) => id === order.id ? null : order.id)} className="w-full p-4 text-left">
                  <div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-amber-400" /><span className="font-black text-white">{order.number}</span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${order.status === "Open" ? "bg-amber-500/15 text-amber-300" : order.status === "Closed" ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-700 text-slate-400"}`}>{order.status}</span></div><span className="text-xs text-slate-400">{dateLabel(order.createdAt)}</span></div>
                  <div className="mt-2 text-sm text-slate-200">{order.supplierName} <span className="mx-1 text-slate-600">·</span> Due {dateLabel(order.expectedAt)}</div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs"><span className="text-slate-300">{order.receivedQty}/{order.orderedQty} units received</span><span className="font-bold text-amber-300">{order.awaitingQty} awaiting</span>{order.total !== null && <span className="text-slate-300">PO {money(order.total)}</span>}</div>
                </button>
                {expandedId === order.id && <div className="space-y-4 border-t border-slate-800 p-4">
                  {order.notes && <div className="rounded-lg bg-slate-900 p-3 text-xs text-slate-400">Order notes: {order.notes}</div>}
                  <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-xs">
                    <thead className="border-b border-slate-800 text-[10px] font-bold uppercase text-slate-500"><tr><th className="py-2">Stock item</th><th className="py-2 text-right">Ordered</th><th className="py-2 text-right">Received</th><th className="py-2 text-right">Remaining</th>{board?.canSeeMoney && <th className="py-2 text-right">Unit price</th>}</tr></thead>
                    <tbody>{order.lines.map((line) => <tr key={line.id} className="border-b border-slate-800/70 text-slate-300"><td className="py-2"><span className="font-bold text-white">{line.itemName}</span><span className="ml-2 text-slate-500">{line.itemSku}</span>{line.itemId === null && <span className="ml-2 text-rose-300">(stock item deleted)</span>}</td><td className="py-2 text-right">{line.quantity} {line.itemUnit}</td><td className="py-2 text-right text-emerald-300">{line.receivedQuantity}</td><td className="py-2 text-right font-bold text-amber-300">{order.status === "Open" ? line.remainingQuantity : 0}</td>{board?.canSeeMoney && <td className="py-2 text-right">{money(line.unitPrice)}</td>}</tr>)}</tbody>
                  </table></div>
                  {order.status === "Open" && <div className="flex flex-wrap gap-2">
                    {order.awaitingQty > 0 && <button className={primaryClass} onClick={() => openReceipt(order)}><PackageCheck className="mr-1 inline h-4 w-4" /> Receive goods · GRN</button>}
                    <button className={secondaryClass} disabled={busy} onClick={() => void finishPo(order, "Closed")}>Close remaining</button>
                    {order.receipts.length === 0 && <button className="rounded-xl border border-rose-800 px-3 py-2 text-xs font-bold text-rose-300 hover:bg-rose-950" disabled={busy} onClick={() => void finishPo(order, "Cancelled")}>Cancel PO</button>}
                  </div>}
                  <div className="border-t border-slate-800 pt-3"><div className="mb-2 text-[11px] font-black uppercase text-slate-400">Goods receipts ({order.receipts.length})</div>{order.receipts.length === 0 ? <p className="text-xs text-slate-500">Nothing received yet.</p> : order.receipts.map((r) => <div key={r.id} className="mb-2 rounded-lg bg-slate-900 p-3 text-xs text-slate-300"><div className="flex flex-wrap justify-between gap-1"><span className="font-black text-emerald-300">{r.number}</span><span>{dateLabel(r.receivedAt)}</span></div><div className="mt-1">{r.lines.map((l) => `${l.itemName} +${l.quantity}`).join(" · ")}</div>{r.deliveryRef && <div className="mt-1 text-slate-400">Supplier note: {r.deliveryRef}</div>}{r.notes && <div className="text-slate-400">{r.notes}</div>}</div>)}</div>
                </div>}
              </article>
            ))}
          </div>
        </section>}
        {panel === "payables" && board?.canSeeMoney && <SupplierBillsView
          suppliers={suppliers.map(({ id, name, active }) => ({ id, name, active }))}
          orders={orders.map(({ id, number, supplierId, status }) => ({ id, number, supplierId, status }))}
          supplierId={supplierId}
        />}
      </div>

      {supplierForm && <Modal title={supplierForm.id ? "Edit supplier" : "New supplier"} onClose={() => setSupplierForm(null)}>
        <form onSubmit={(event) => void saveSupplier(event)} className="space-y-4">
          {error && <p role="alert" className="rounded-lg bg-rose-500/10 p-2 text-xs font-bold text-rose-300">{error}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["name", "Supplier name *", true], ["contactName", "Contact person", false],
              ["phone", "Phone", false], ["email", "Email", false],
            ] as const).map(([key, label, required]) => <label key={key}><span className={labelClass}>{label}</span><input className={inputClass} required={required} value={supplierForm[key]} onChange={(e) => setSupplierForm({ ...supplierForm, [key]: e.target.value })} /></label>)}
          </div>
          <label><span className={labelClass}>Address</span><input className={inputClass} value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} /></label>
          <label><span className={labelClass}>Notes</span><textarea rows={3} className={inputClass} value={supplierForm.notes} onChange={(e) => setSupplierForm({ ...supplierForm, notes: e.target.value })} /></label>
          <div className="flex justify-end gap-2"><button type="button" className={secondaryClass} onClick={() => setSupplierForm(null)}>Cancel</button><button disabled={busy} className={primaryClass}>Save supplier</button></div>
        </form>
      </Modal>}

      {poForm && <Modal title="New purchase order" onClose={() => { setPoForm(null); setReorderItem(null); }}>
        <form onSubmit={(event) => void savePo(event)} className="space-y-5">
          {error && <p role="alert" className="rounded-lg bg-rose-500/10 p-2 text-xs font-bold text-rose-300">{error}</p>}
          {reorderItem && <div className="rounded-xl border border-violet-500/30 bg-violet-500/10 p-3 text-sm text-violet-200"><AlertTriangle className="mr-1 inline h-4 w-4" />Reorder alert: <b>{reorderItem.name}</b> · {reorderItem.stockQuantity} {reorderItem.unit} on shelf, {reorderItem.onOrder} already on open POs. Suggested refill: {suggestedReorderQty(reorderItem.stockQuantity, reorderItem.reorderLevel, reorderItem.onOrder)} {reorderItem.unit}. {reorderItem.onOrder > 0 && <span>Check the awaiting list to avoid duplicate orders.</span>}</div>}
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className={labelClass}>Supplier *</span><select className={inputClass} required value={poForm.supplierId} onChange={(e) => setPoForm({ ...poForm, supplierId: e.target.value })}><option value="">Select a supplier</option>{suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
            <label><span className={labelClass}>Expected delivery</span><input type="date" className={inputClass} value={poForm.expectedAt} onChange={(e) => setPoForm({ ...poForm, expectedAt: e.target.value })} /></label>
          </div>
          {suppliers.every((s) => !s.active) && <div className="text-xs text-rose-300">Add an active supplier before making a PO.</div>}
          <div className="space-y-2"><div className="flex items-center justify-between"><h3 className="text-sm font-black text-white">Stock lines ({poForm.lines.length})</h3><button type="button" className={secondaryClass} disabled={poForm.lines.length >= 50} onClick={() => setPoForm({ ...poForm, lines: [...poForm.lines, { itemId: "", quantity: "1", unitPrice: "0.00" }] })}><Plus className="mr-1 inline h-3.5 w-3.5" /> Add line</button></div>
            {poForm.lines.map((line, index) => <div key={index} className="grid gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3 sm:grid-cols-[minmax(0,1fr)_100px_110px_35px]">
              <label><span className={labelClass}>Stock item *</span><select required className={inputClass} value={line.itemId} onChange={(e) => chooseItem(index, e.target.value)}><option value="">Select SKU / material</option>{board?.items.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></label>
              <label><span className={labelClass}>Qty *</span><input type="number" min="1" max="1000000" step="1" required className={inputClass} value={line.quantity} onChange={(e) => patchLine(index, { quantity: e.target.value })} /></label>
              {board?.canSeeMoney ? <label><span className={labelClass}>Unit price $</span><input type="number" min="0" max="999999.99" step="0.01" className={inputClass} value={line.unitPrice} onChange={(e) => patchLine(index, { unitPrice: e.target.value })} /></label> : <div className="self-end pb-2 text-[11px] text-slate-500">Price restricted</div>}
              <button type="button" aria-label="Remove stock line" className="mt-5 rounded-lg text-slate-500 hover:text-rose-300 disabled:opacity-30" disabled={poForm.lines.length === 1} onClick={() => setPoForm({ ...poForm, lines: poForm.lines.filter((_, i) => i !== index) })}><X className="h-4 w-4" /></button>
            </div>)}
          </div>
          {!board?.canSeeMoney && <p className="text-xs text-slate-400">This account has Purchasing access but not Invoicing &amp; Money access; this PO records quantities at $0.00. Ask a Manager for a money grant to enter prices.</p>}
          <label><span className={labelClass}>Order notes</span><textarea rows={2} className={inputClass} value={poForm.notes} onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })} /></label>
          <div className="flex justify-end gap-2 border-t border-slate-800 pt-4"><button type="button" className={secondaryClass} onClick={() => setPoForm(null)}>Cancel</button><button disabled={busy || !board || suppliers.every((s) => !s.active)} className={primaryClass}>Create purchase order</button></div>
        </form>
      </Modal>}

      {receiptOrder && <Modal title={`Goods receipt · ${receiptOrder.number}`} onClose={() => setReceiptOrder(null)}>
        <form onSubmit={(event) => void saveReceipt(event)} className="space-y-4">
          {error && <p role="alert" className="rounded-lg bg-rose-500/10 p-2 text-xs font-bold text-rose-300">{error}</p>}
          <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">Enter only what physically arrived. Posting this GRN adds those quantities to Inventory immediately. A retry with the same request key cannot add stock twice.</p>
          <div className="space-y-2">{receiptOrder.lines.filter((l) => l.remainingQuantity > 0).map((line) => <label key={line.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3"><span className="min-w-0 flex-1 text-xs font-bold text-white">{line.itemName} <span className="text-slate-500">{line.itemSku} · {line.remainingQuantity} {line.itemUnit} outstanding</span>{line.itemId === null && <span className="ml-2 text-rose-300">Item deleted — cannot receive</span>}</span><input aria-label={`Received quantity for ${line.itemName}`} type="number" min="0" max={line.remainingQuantity} step="1" disabled={line.itemId === null} className={`${inputClass} w-24 text-right`} value={receiptQuantities[line.id] ?? "0"} onChange={(e) => setReceiptQuantities({ ...receiptQuantities, [line.id]: e.target.value })} /></label>)}</div>
          <div className="grid gap-3 sm:grid-cols-2"><label><span className={labelClass}>Supplier delivery note / reference</span><input className={inputClass} value={receiptRef} onChange={(e) => setReceiptRef(e.target.value)} placeholder="Optional supplier document #" /></label><label><span className={labelClass}>Reception notes</span><input className={inputClass} value={receiptNotes} onChange={(e) => setReceiptNotes(e.target.value)} placeholder="Condition, packing…" /></label></div>
          <div className="flex justify-end gap-2 border-t border-slate-800 pt-4"><button type="button" className={secondaryClass} onClick={() => setReceiptOrder(null)}>Cancel</button><button disabled={busy || Object.values(receiptQuantities).every((value) => !Number(value))} className={primaryClass}><PackageCheck className="mr-1 inline h-4 w-4" />Post GRN &amp; increase stock</button></div>
        </form>
      </Modal>}
    </div>
  );
}
