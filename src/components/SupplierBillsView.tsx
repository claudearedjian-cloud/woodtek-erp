"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle, Ban, CalendarDays, CheckCircle2, CircleDollarSign,
  FileText, Plus, RefreshCw, Search, Undo2, X,
} from "lucide-react";
import { PAYABLE_AGING_BUCKETS, PAYABLE_AGING_LABELS, SUPPLIER_PAYMENT_METHODS } from "@/lib/payables";
import { newSupplierPaymentRequestKey } from "@/lib/purchasing";

type SupplierPick = { id: number; name: string; active: boolean };
type OrderPick = { id: number; number: string; supplierId: number; status: string };
type Payment = {
  id: number; amountCents: number; paidAt: string; method: string;
  reference: string; notes: string; status: string; voidedAt: string | null;
  voidReason: string; createdAt: string;
};
type SupplierBill = {
  id: number; number: string; supplierId: number; supplierName: string;
  purchaseOrderId: number | null; purchaseOrderNumber: string | null;
  reference: string; issueDate: string; dueDate: string | null;
  totalCents: number; paidCents: number; outstandingCents: number;
  paymentState: string; overdueDays: number | null; notes: string;
  status: string; cancelledAt: string | null; cancelReason: string;
  createdAt: string; payments: Payment[];
};
type AgingRow = {
  supplierId: number; supplierName: string;
  buckets: Record<(typeof PAYABLE_AGING_BUCKETS)[number], number>;
  totalCents: number; overdueCents: number;
};
type PayablesBoard = {
  bills: SupplierBill[]; aging: AgingRow[];
  totals: { outstandingCents: number; overdueCents: number; openBillCount: number };
  today: string;
};
type BillDraft = {
  supplierId: string; purchaseOrderId: string; reference: string;
  issueDate: string; dueDate: string; amount: string; notes: string;
};
type PaymentDraft = {
  billId: number; amount: string; paidAt: string; method: string;
  reference: string; notes: string; requestKey: string;
};

const inputClass = "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:border-amber-500 focus:outline-none";
const labelClass = "mb-1 block text-[11px] font-bold uppercase tracking-wide text-slate-400";
const primaryClass = "rounded-xl bg-amber-500 px-4 py-2 text-sm font-black text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40";
const secondaryClass = "rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200 hover:border-amber-500/60 hover:text-white disabled:opacity-50";
const money = (cents: number) => `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateLabel = (date: string | null) => date ? date.slice(0, 10) : "No due date";

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method, headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

async function loadSupplierPayables(): Promise<PayablesBoard> {
  return await send("/api/purchasing/payables", "GET") as PayablesBoard;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="modal-backdrop fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-slate-950/75 p-4 backdrop-blur-sm">
      <div role="dialog" aria-modal="true" aria-label={title} className="my-auto max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-7">
        <div className="mb-5 flex items-start justify-between gap-3 border-b border-slate-800 pb-4">
          <h2 className="text-lg font-black text-white">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </div>
        {children}
      </div>
    </div>, document.body,
  );
}

function errorText(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

export default function SupplierBillsView({
  suppliers, orders, supplierId,
}: {
  suppliers: SupplierPick[]; orders: OrderPick[]; supplierId: number | null;
}) {
  const [board, setBoard] = useState<PayablesBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [billForm, setBillForm] = useState<BillDraft | null>(null);
  const [paymentForm, setPaymentForm] = useState<PaymentDraft | null>(null);
  const [cancelForm, setCancelForm] = useState<{ billId: number; reason: string } | null>(null);
  const [voidForm, setVoidForm] = useState<{ paymentId: number; reason: string } | null>(null);

  const refresh = async () => {
    try {
      setBoard(await loadSupplierPayables());
      setError("");
    } catch (cause) {
      setBoard(null); // never retain a previous profile's payables after a 403
      setError(errorText(cause, "Could not load supplier bills."));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    let active = true;
    loadSupplierPayables().then((data) => {
      if (active) { setBoard(data); setError(""); }
    }).catch((cause: unknown) => {
      if (active) { setBoard(null); setError(errorText(cause, "Could not load supplier bills.")); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const openNewBill = () => {
    const selectedSupplier = supplierId == null ? "" : String(supplierId);
    setBillForm({
      supplierId: selectedSupplier, purchaseOrderId: "", reference: "",
      issueDate: board?.today ?? new Date().toISOString().slice(0, 10),
      dueDate: "", amount: "", notes: "",
    });
    setError("");
  };

  const saveBill = async (event: FormEvent) => {
    event.preventDefault();
    if (!billForm || busy) return;
    setBusy(true); setError("");
    try {
      const result = await send("/api/purchasing/bills", "POST", {
        supplierId: Number(billForm.supplierId),
        purchaseOrderId: billForm.purchaseOrderId ? Number(billForm.purchaseOrderId) : null,
        reference: billForm.reference,
        issueDate: billForm.issueDate,
        dueDate: billForm.dueDate || null,
        amount: billForm.amount,
        notes: billForm.notes,
      });
      setBillForm(null);
      setExpandedId(result.id);
      setShowHistory(true);
      setNotice(`${result.number} recorded from supplier invoice ${result.reference}.`);
      await refresh();
    } catch (cause) { setError(errorText(cause, "Could not record supplier bill.")); }
    finally { setBusy(false); }
  };

  const openPayment = (bill: SupplierBill) => {
    try {
      setPaymentForm({
        billId: bill.id,
        amount: (bill.outstandingCents / 100).toFixed(2),
        paidAt: board?.today ?? new Date().toISOString().slice(0, 10),
        method: "Transfer", reference: "", notes: "",
        requestKey: newSupplierPaymentRequestKey(),
      });
      setError("");
    } catch (cause) { setError(errorText(cause, "Could not start supplier payment.")); }
  };

  const savePayment = async (event: FormEvent) => {
    event.preventDefault();
    if (!paymentForm || busy) return;
    setBusy(true); setError("");
    try {
      const result = await send(`/api/purchasing/bills/${paymentForm.billId}/payments`, "POST", paymentForm);
      setPaymentForm(null);
      setNotice(result.replayed ? "This payment was already recorded; no duplicate payment was added." : "Supplier payment recorded.");
      await refresh();
    } catch (cause) { setError(errorText(cause, "Could not record supplier payment.")); }
    finally { setBusy(false); }
  };

  const cancelBill = async (event: FormEvent) => {
    event.preventDefault();
    if (!cancelForm || busy) return;
    setBusy(true); setError("");
    try {
      const result = await send(`/api/purchasing/bills/${cancelForm.billId}/cancel`, "POST", { reason: cancelForm.reason });
      setCancelForm(null);
      setNotice(result.replayed ? `${result.number} was already cancelled.` : `${result.number} cancelled; the reason is retained with its history.`);
      await refresh();
    } catch (cause) { setError(errorText(cause, "Could not cancel supplier bill.")); }
    finally { setBusy(false); }
  };

  const voidPayment = async (event: FormEvent) => {
    event.preventDefault();
    if (!voidForm || busy) return;
    setBusy(true); setError("");
    try {
      const result = await send(`/api/purchasing/payments/${voidForm.paymentId}/void`, "POST", { reason: voidForm.reason });
      setVoidForm(null);
      setNotice(result.replayed ? "This payment was already voided." : "Supplier payment voided; it remains visible in the audit history.");
      await refresh();
    } catch (cause) { setError(errorText(cause, "Could not void supplier payment.")); }
    finally { setBusy(false); }
  };

  const allBills = board?.bills ?? [];
  const supplierFilteredBills = allBills.filter((bill) => supplierId === null || bill.supplierId === supplierId);
  const liveOpenBills = supplierFilteredBills.filter((bill) => bill.status === "Open" && bill.outstandingCents > 0);
  const overdueCents = liveOpenBills.reduce((sum, bill) => sum + (bill.overdueDays !== null && bill.overdueDays > 0 ? bill.outstandingCents : 0), 0);
  const outstandingCents = liveOpenBills.reduce((sum, bill) => sum + bill.outstandingCents, 0);
  const visibleBills = supplierFilteredBills.filter((bill) => (
    (showHistory || (bill.status === "Open" && bill.outstandingCents > 0))
    && (!search || [bill.number, bill.reference, bill.supplierName, bill.purchaseOrderNumber ?? ""]
      .some((value) => value.toLowerCase().includes(search.trim().toLowerCase())))
  ));
  const visibleAging = (board?.aging ?? []).filter((row) => supplierId === null || row.supplierId === supplierId);
  const selectedBill = paymentForm ? allBills.find((bill) => bill.id === paymentForm.billId) : null;
  const selectedCancelBill = cancelForm ? allBills.find((bill) => bill.id === cancelForm.billId) : null;

  return (
    <section className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-emerald-300"><FileText className="h-4 w-4" /> Accounts payable</div>
          <h2 className="text-lg font-black text-white">{supplierId !== null ? `${suppliers.find((s) => s.id === supplierId)?.name ?? "Supplier"} · ` : ""}Supplier bills</h2>
          <p className="mt-1 text-xs text-slate-400">Record supplier invoice totals, link a PO, track due dates and post payments. The entered amount is the supplier&apos;s total including any tax.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={secondaryClass} onClick={() => { setLoading(true); void refresh(); }} disabled={loading}><RefreshCw className="mr-1 inline h-4 w-4" /> Refresh</button>
          <button className={primaryClass} onClick={openNewBill} disabled={suppliers.length === 0}><Plus className="mr-1 inline h-4 w-4" /> Supplier bill</button>
        </div>
      </header>

      {notice && <div role="status" className="mb-4 flex items-start justify-between gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm font-bold text-emerald-300"><span><CheckCircle2 className="mr-2 inline h-4 w-4" />{notice}</span><button aria-label="Dismiss notice" onClick={() => setNotice("")}><X className="h-4 w-4" /></button></div>}
      {error && <div role="alert" className="mb-4 rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm font-bold text-rose-300"><AlertTriangle className="mr-2 inline h-4 w-4" />{error}</div>}

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {[
          { label: "A/P outstanding", value: money(outstandingCents), sub: `${liveOpenBills.length} bill${liveOpenBills.length === 1 ? "" : "s"} · ${supplierId === null ? "all suppliers" : "selected supplier"}`, Icon: CircleDollarSign },
          { label: "Overdue", value: money(overdueCents), sub: "due date has passed", Icon: CalendarDays },
          { label: "Open bills", value: String(liveOpenBills.length), sub: "with a remaining balance", Icon: FileText },
        ].map(({ label, value, sub, Icon }) => (
          <div key={label} className="rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
            <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wide text-slate-400">{label}<Icon className="h-4 w-4 text-emerald-300" /></div>
            <div className="mt-2 text-2xl font-black text-white">{value}</div>
            <div className="text-xs text-slate-500">{sub}</div>
          </div>
        ))}
      </div>

      <section className="mb-5 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div><h3 className="font-black text-white">A/P aging</h3><p className="text-[11px] text-slate-500">Open unpaid balances by due date · as of {board?.today ?? "—"}</p></div>
          <span className="text-[11px] text-slate-500">Current / not yet due is grouped together</span>
        </div>
        {loading && <p className="py-5 text-center text-xs text-slate-500">Loading supplier balances…</p>}
        {!loading && visibleAging.length === 0 && <p className="rounded-lg border border-dashed border-slate-800 p-5 text-center text-xs text-slate-500">No supplier balances are outstanding for this filter.</p>}
        {!loading && visibleAging.length > 0 && <div className="overflow-x-auto"><table className="w-full min-w-[750px] text-left text-xs">
          <thead className="border-b border-slate-800 text-[10px] font-bold uppercase text-slate-500"><tr><th className="py-2 pr-3">Supplier</th>{PAYABLE_AGING_BUCKETS.map((bucket) => <th key={bucket} className="px-2 py-2 text-right">{PAYABLE_AGING_LABELS[bucket]}</th>)}<th className="py-2 pl-2 text-right">Total</th></tr></thead>
          <tbody>{visibleAging.map((row) => <tr key={row.supplierId} className="border-b border-slate-900 last:border-0"><td className="py-2 pr-3 font-bold text-slate-200">{row.supplierName}</td>{PAYABLE_AGING_BUCKETS.map((bucket) => <td key={bucket} className={`px-2 py-2 text-right ${bucket === "d90+" && row.buckets[bucket] > 0 ? "font-bold text-rose-300" : "text-slate-400"}`}>{money(row.buckets[bucket])}</td>)}<td className="py-2 pl-2 text-right font-black text-white">{money(row.totalCents)}</td></tr>)}</tbody>
        </table></div>}
      </section>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-black text-white">Supplier bill register</h3><p className="text-xs text-slate-400">{showHistory ? "Open, settled and cancelled records" : "Bills with an open balance"}</p></div>
        <button className={secondaryClass} onClick={() => setShowHistory((value) => !value)}>{showHistory ? "Open balances only" : "Include paid & cancelled"}</button>
      </div>
      <div className="relative mb-4"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" /><input aria-label="Search supplier bills" placeholder="Search supplier, bill reference, SB or PO number" className={`${inputClass} pl-9`} value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      {loading && <div className="rounded-xl border border-dashed border-slate-700 p-9 text-center text-sm text-slate-400">Loading supplier bills…</div>}
      {!loading && board && visibleBills.length === 0 && <div className="rounded-xl border border-dashed border-slate-700 p-9 text-center text-sm text-slate-400">{showHistory ? "No supplier bills match this filter." : "No open supplier bills match this filter. Record one when a supplier invoice arrives."}</div>}
      <div className="space-y-3">
        {visibleBills.map((bill) => {
          const expanded = expandedId === bill.id;
          const statusLabel = bill.status === "Cancelled" ? "Cancelled" : bill.paymentState;
          const statusStyle = bill.status === "Cancelled" ? "bg-slate-700 text-slate-300" : bill.paymentState === "Paid" ? "bg-emerald-500/15 text-emerald-300" : bill.overdueDays !== null && bill.overdueDays > 0 ? "bg-rose-500/15 text-rose-300" : bill.paymentState === "Partially paid" ? "bg-sky-500/15 text-sky-300" : "bg-amber-500/15 text-amber-300";
          return <article key={bill.id} className="rounded-xl border border-slate-700/80 bg-slate-950/60">
            <button type="button" onClick={() => setExpandedId((id) => id === bill.id ? null : bill.id)} className="w-full p-4 text-left">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><FileText className="h-4 w-4 text-emerald-300" /><span className="font-black text-white">{bill.number}</span><span className="text-xs text-slate-400">Supplier ref: <b className="text-slate-200">{bill.reference}</b></span><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${statusStyle}`}>{statusLabel}</span></div>
                  <div className="mt-2 text-sm text-slate-200">{bill.supplierName}{bill.purchaseOrderNumber && <span className="ml-2 text-xs text-slate-500">· {bill.purchaseOrderNumber}</span>}</div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-400"><span>Bill date {dateLabel(bill.issueDate)}</span><span className={bill.overdueDays !== null && bill.overdueDays > 0 ? "font-bold text-rose-300" : ""}>Due {dateLabel(bill.dueDate)}{bill.overdueDays !== null && bill.overdueDays > 0 ? ` · ${bill.overdueDays} days overdue` : ""}</span></div>
                </div>
                <div className="text-right"><div className="font-black text-white">{money(bill.totalCents)}</div><div className="mt-1 text-xs text-slate-400">{bill.outstandingCents > 0 ? `${money(bill.outstandingCents)} outstanding` : bill.status === "Cancelled" ? "No balance" : "Settled"}</div></div>
              </div>
            </button>
            {expanded && <div className="space-y-4 border-t border-slate-800 p-4">
              <div className="grid gap-3 text-xs sm:grid-cols-2">
                <div className="rounded-lg bg-slate-900 p-3"><span className="text-slate-500">Supplier invoice reference</span><div className="mt-1 font-bold text-white">{bill.reference}</div></div>
                <div className="rounded-lg bg-slate-900 p-3"><span className="text-slate-500">Linked purchase order</span><div className="mt-1 font-bold text-white">{bill.purchaseOrderNumber ?? "Not linked"}</div></div>
                <div className="rounded-lg bg-slate-900 p-3"><span className="text-slate-500">Bill total · paid · outstanding</span><div className="mt-1 font-bold text-white">{money(bill.totalCents)} · {money(bill.paidCents)} · {money(bill.outstandingCents)}</div></div>
                <div className="rounded-lg bg-slate-900 p-3"><span className="text-slate-500">Issue date · due date</span><div className="mt-1 font-bold text-white">{dateLabel(bill.issueDate)} · {dateLabel(bill.dueDate)}</div></div>
              </div>
              {bill.notes && <div className="rounded-lg bg-slate-900 p-3 text-xs text-slate-400">Notes: {bill.notes}</div>}
              {bill.status === "Cancelled" && <div className="rounded-lg border border-slate-700 bg-slate-900 p-3 text-xs text-slate-400"><b className="text-slate-200">Cancellation reason:</b> {bill.cancelReason || "Not recorded"}</div>}
              <div className="flex flex-wrap gap-2">
                {bill.status === "Open" && bill.outstandingCents > 0 && <button className={primaryClass} disabled={busy} onClick={() => openPayment(bill)}><CircleDollarSign className="mr-1 inline h-4 w-4" />Record payment</button>}
                {bill.status === "Open" && bill.paidCents === 0 && <button className="rounded-xl border border-rose-800 px-3 py-2 text-xs font-bold text-rose-300 hover:bg-rose-950 disabled:opacity-50" disabled={busy} onClick={() => { setCancelForm({ billId: bill.id, reason: "" }); setError(""); }}><Ban className="mr-1 inline h-3.5 w-3.5" />Cancel bill</button>}
              </div>
              <div className="border-t border-slate-800 pt-3">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-black uppercase text-slate-400"><CircleDollarSign className="h-3.5 w-3.5" />Payments ({bill.payments.length})</div>
                {bill.payments.length === 0 ? <p className="text-xs text-slate-500">No payments recorded.</p> : <div className="space-y-2">
                  {bill.payments.map((payment) => <div key={payment.id} className={`flex flex-wrap items-start justify-between gap-3 rounded-lg p-3 ${payment.status === "Voided" ? "bg-slate-900/60 opacity-75" : "bg-slate-900"}`}>
                    <div className="text-xs"><div className="flex flex-wrap items-center gap-2"><b className={payment.status === "Voided" ? "text-slate-400 line-through" : "text-emerald-300"}>{money(payment.amountCents)}</b><span className="text-slate-400">{payment.method} · {dateLabel(payment.paidAt)}</span><span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${payment.status === "Voided" ? "bg-slate-700 text-slate-300" : "bg-emerald-500/10 text-emerald-300"}`}>{payment.status}</span></div>
                      {payment.reference && <div className="mt-1 text-slate-400">Reference: {payment.reference}</div>}{payment.notes && <div className="text-slate-500">{payment.notes}</div>}{payment.status === "Voided" && <div className="mt-1 text-slate-500">Voided {dateLabel(payment.voidedAt)} · {payment.voidReason}</div>}
                    </div>
                    {payment.status === "Posted" && <button className="text-[11px] font-bold text-rose-300 hover:text-rose-200 disabled:opacity-50" disabled={busy} onClick={() => { setVoidForm({ paymentId: payment.id, reason: "" }); setError(""); }}><Undo2 className="mr-1 inline h-3.5 w-3.5" />Void payment</button>}
                  </div>)}
                </div>}
              </div>
            </div>}
          </article>;
        })}
      </div>

      {billForm && <Modal title="Record supplier bill" onClose={() => { if (!busy) setBillForm(null); }}>
        <form onSubmit={(event) => void saveBill(event)} className="space-y-4">
          {error && <p role="alert" className="rounded-lg bg-rose-500/10 p-2 text-xs font-bold text-rose-300">{error}</p>}
          <p className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-xs text-amber-100">Enter the supplier&apos;s invoice total, including any tax shown on their document. This records the payable only; it does not alter inventory or PO prices.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className={labelClass}>Supplier *</span><select required className={inputClass} value={billForm.supplierId} onChange={(event) => setBillForm({ ...billForm, supplierId: event.target.value, purchaseOrderId: "" })}><option value="">Select supplier</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}{supplier.active ? "" : " (archived)"}</option>)}</select></label>
            <label><span className={labelClass}>Link purchase order</span><select className={inputClass} value={billForm.purchaseOrderId} onChange={(event) => setBillForm({ ...billForm, purchaseOrderId: event.target.value })}><option value="">No PO link</option>{orders.filter((order) => String(order.supplierId) === billForm.supplierId).map((order) => <option key={order.id} value={order.id}>{order.number} · {order.status}</option>)}</select></label>
            <label><span className={labelClass}>Supplier invoice reference *</span><input required maxLength={120} className={inputClass} value={billForm.reference} onChange={(event) => setBillForm({ ...billForm, reference: event.target.value })} placeholder="Their invoice number" /></label>
            <label><span className={labelClass}>Total amount $ *</span><input required type="number" min="0.01" max="999999.99" step="0.01" className={inputClass} value={billForm.amount} onChange={(event) => setBillForm({ ...billForm, amount: event.target.value })} /></label>
            <label><span className={labelClass}>Bill date *</span><input required type="date" className={inputClass} value={billForm.issueDate} onChange={(event) => setBillForm({ ...billForm, issueDate: event.target.value })} /></label>
            <label><span className={labelClass}>Due date</span><input type="date" min={billForm.issueDate} className={inputClass} value={billForm.dueDate} onChange={(event) => setBillForm({ ...billForm, dueDate: event.target.value })} /></label>
          </div>
          <label><span className={labelClass}>Notes</span><textarea rows={2} maxLength={1000} className={inputClass} value={billForm.notes} onChange={(event) => setBillForm({ ...billForm, notes: event.target.value })} placeholder="Optional supplier terms or context" /></label>
          <div className="flex justify-end gap-2 border-t border-slate-800 pt-4"><button type="button" className={secondaryClass} disabled={busy} onClick={() => setBillForm(null)}>Cancel</button><button className={primaryClass} disabled={busy || suppliers.length === 0}>Record supplier bill</button></div>
        </form>
      </Modal>}

      {paymentForm && <Modal title={`Record payment · ${selectedBill?.number ?? "supplier bill"}`} onClose={() => { if (!busy) setPaymentForm(null); }}>
        <form onSubmit={(event) => void savePayment(event)} className="space-y-4">
          {error && <p role="alert" className="rounded-lg bg-rose-500/10 p-2 text-xs font-bold text-rose-300">{error}</p>}
          <p className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3 text-xs text-emerald-100">Outstanding on this bill: <b>{money(selectedBill?.outstandingCents ?? 0)}</b>. Payments cannot exceed the remaining balance. A network retry with the same request key cannot double-post this payment.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label><span className={labelClass}>Amount $ *</span><input required type="number" min="0.01" max="999999.99" step="0.01" className={inputClass} value={paymentForm.amount} onChange={(event) => setPaymentForm({ ...paymentForm, amount: event.target.value })} /></label>
            <label><span className={labelClass}>Payment date *</span><input required type="date" className={inputClass} value={paymentForm.paidAt} onChange={(event) => setPaymentForm({ ...paymentForm, paidAt: event.target.value })} /></label>
            <label><span className={labelClass}>Method *</span><select className={inputClass} value={paymentForm.method} onChange={(event) => setPaymentForm({ ...paymentForm, method: event.target.value })}>{SUPPLIER_PAYMENT_METHODS.map((method) => <option key={method}>{method}</option>)}</select></label>
            <label><span className={labelClass}>Bank / check reference</span><input maxLength={80} className={inputClass} value={paymentForm.reference} onChange={(event) => setPaymentForm({ ...paymentForm, reference: event.target.value })} /></label>
          </div>
          <label><span className={labelClass}>Notes</span><textarea rows={2} maxLength={300} className={inputClass} value={paymentForm.notes} onChange={(event) => setPaymentForm({ ...paymentForm, notes: event.target.value })} /></label>
          <div className="flex justify-end gap-2 border-t border-slate-800 pt-4"><button type="button" className={secondaryClass} disabled={busy} onClick={() => setPaymentForm(null)}>Cancel</button><button className={primaryClass} disabled={busy}>Record payment</button></div>
        </form>
      </Modal>}

      {cancelForm && <Modal title={`Cancel bill · ${selectedCancelBill?.number ?? "supplier bill"}`} onClose={() => { if (!busy) setCancelForm(null); }}>
        <form onSubmit={(event) => void cancelBill(event)} className="space-y-4">
          {error && <p role="alert" className="rounded-lg bg-rose-500/10 p-2 text-xs font-bold text-rose-300">{error}</p>}
          <p className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3 text-xs text-rose-100">Cancellation is permanent in the bill register. Bills with posted payments must have those payments voided first; cancellation never deletes the record.</p>
          <label><span className={labelClass}>Reason *</span><textarea required maxLength={300} rows={3} className={inputClass} value={cancelForm.reason} onChange={(event) => setCancelForm({ ...cancelForm, reason: event.target.value })} placeholder="Duplicate entry, supplier credit, incorrect bill…" /></label>
          <div className="flex justify-end gap-2"><button type="button" className={secondaryClass} disabled={busy} onClick={() => setCancelForm(null)}>Keep bill</button><button className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-black text-white hover:bg-rose-500 disabled:opacity-50" disabled={busy}>Cancel bill</button></div>
        </form>
      </Modal>}

      {voidForm && <Modal title="Void supplier payment" onClose={() => { if (!busy) setVoidForm(null); }}>
        <form onSubmit={(event) => void voidPayment(event)} className="space-y-4">
          {error && <p role="alert" className="rounded-lg bg-rose-500/10 p-2 text-xs font-bold text-rose-300">{error}</p>}
          <p className="rounded-xl border border-rose-500/25 bg-rose-500/5 p-3 text-xs text-rose-100">The payment will remain visible in the history, but will no longer reduce the bill&apos;s outstanding balance.</p>
          <label><span className={labelClass}>Reason *</span><textarea required maxLength={300} rows={3} className={inputClass} value={voidForm.reason} onChange={(event) => setVoidForm({ ...voidForm, reason: event.target.value })} placeholder="Wrong amount, duplicate payment, bank reversal…" /></label>
          <div className="flex justify-end gap-2"><button type="button" className={secondaryClass} disabled={busy} onClick={() => setVoidForm(null)}>Keep payment</button><button className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-black text-white hover:bg-rose-500 disabled:opacity-50" disabled={busy}>Void payment</button></div>
        </form>
      </Modal>}
    </section>
  );
}
