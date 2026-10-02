"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRight, Banknote, FileDown, FileText, Plus, Receipt, RefreshCw,
  Search, Trash2, Undo2, Users, X,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  AGING_BUCKETS, AGING_LABELS, LEBANON_VAT_RATE, MAX_LINE_DESCRIPTION,
  MAX_STOCK_PICKER_RESULTS, PAYMENT_METHODS, filterStockItems, stockLineDescription,
  stockPickerQuery,
  type AgingBucket, type DocumentKind, type StockIdentity,
} from "@/lib/invoicing";

type StockItem = StockIdentity;
type DocLine = {
  id: number; invoiceId: number; inventoryItemId: number | null; description: string; quantity: string;
  unitPriceCents: number; lineTotalCents: number;
};
type Payment = {
  id: number; invoiceId: number; amountCents: number; paidAt: string;
  method: string; reference: string; notes: string;
};
type Doc = {
  id: number; kind: DocumentKind; number: string;
  customerId: number | null; customerName: string; customerCompany: string;
  issueDate: string; dueDate: string | null; status: string;
  vatRate: string; subtotalCents: number; vatCents: number; totalCents: number;
  notes: string; convertedFromId: number | null;
  lines: DocLine[]; payments: Payment[]; paidCents: number; outstandingCents: number;
  paymentState: "Paid" | "Partially paid" | "Unpaid" | null;
  overdueDays: number | null;
};
type Client = { id: number; name: string; company: string; creditLimit: string; currentBalance: string };
type AgingRow = {
  customerId: number; name: string; company: string;
  buckets: Record<AgingBucket, number>; totalCents: number; overdueCents: number;
};
type Board = { documents: Doc[]; customers: Client[]; aging: AgingRow[]; today: string };

type DraftLine = { inventoryItemId: number | null; description: string; quantity: string; unitPrice: string };
type DocDraft = {
  kind: DocumentKind; customerId: string; issueDate: string; dueDate: string;
  vatRate: string; notes: string; lines: DraftLine[];
};
type StockStatus = "idle" | "loading" | "ready" | "error";

const money = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateLabel = (date: string | null) => (date ? date.slice(0, 10) : "—");

const emptyLine = (): DraftLine => ({ inventoryItemId: null, description: "", quantity: "1", unitPrice: "0.00" });

const emptyDraft = (kind: DocumentKind, today: string): DocDraft => ({
  kind,
  customerId: "",
  issueDate: today,
  dueDate: "",
  vatRate: LEBANON_VAT_RATE,
  notes: "",
  lines: [emptyLine()],
});

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
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

function stateBadge(doc: Doc) {
  if (doc.status === "Cancelled") return <span className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-black text-slate-300">Cancelled</span>;
  if (doc.kind === "Quote") {
    return doc.status === "Converted"
      ? <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[10px] font-black text-blue-300">Converted</span>
      : <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-black text-amber-300">Open quote</span>;
  }
  if (doc.paymentState === "Paid") return <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-black text-emerald-300">Paid</span>;
  if (doc.paymentState === "Partially paid") return <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-black text-amber-300">Part paid</span>;
  if ((doc.overdueDays ?? 0) > 0) return <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-black text-rose-300">{doc.overdueDays}d overdue</span>;
  return <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] font-black text-sky-300">Unpaid</span>;
}

/** House-style printable PDF (same palette as the client statement). */
function exportPdf(doc: Doc) {
  const pdf = new jsPDF();
  pdf.setFillColor(15, 23, 42);
  pdf.rect(0, 0, 210, 26, "F");
  pdf.setFillColor(245, 158, 11);
  pdf.rect(0, 26, 210, 1.2, "F");
  pdf.setTextColor(245, 158, 11);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(16);
  pdf.text("WOODTEK", 14, 12);
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(11);
  pdf.text(doc.kind === "Quote" ? "QUOTATION" : "VAT INVOICE", 14, 20);
  pdf.setFontSize(9);
  pdf.setTextColor(200, 210, 230);
  pdf.text(doc.number, 196, 12, { align: "right" });
  pdf.text("Furniture Service Center", 196, 20, { align: "right" });

  pdf.setTextColor(15, 23, 42);
  pdf.setFontSize(15);
  pdf.setFont("helvetica", "bold");
  pdf.text(String(doc.customerCompany || doc.customerName || "Client"), 14, 40);
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  pdf.setTextColor(71, 85, 105);
  if (doc.customerCompany && doc.customerName) pdf.text(doc.customerName, 14, 46);
  pdf.text(`Issue date: ${dateLabel(doc.issueDate)}`, 196, 40, { align: "right" });
  pdf.text(`${doc.kind === "Quote" ? "Valid until" : "Due date"}: ${dateLabel(doc.dueDate)}`, 196, 46, { align: "right" });
  if (doc.kind === "Invoice") {
    pdf.text(`Status: ${doc.paymentState ?? doc.status}`, 196, 52, { align: "right" });
  }

  autoTable(pdf, {
    startY: 58,
    head: [["#", "Description", "Qty", "Unit price", "Total"]],
    body: doc.lines.map((line, index) => [
      String(index + 1),
      line.description,
      line.quantity,
      money(line.unitPriceCents),
      money(line.lineTotalCents),
    ]),
    styles: { fontSize: 9, cellPadding: 2.5 },
    headStyles: { fillColor: [30, 41, 59], textColor: [245, 158, 11] },
    columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "right" } },
  });

  autoTable(pdf, {
    startY: (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
      ? (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
      : 80,
    body: [
      ["Subtotal", money(doc.subtotalCents)],
      [`VAT ${doc.vatRate}%`, money(doc.vatCents)],
      ["TOTAL", money(doc.totalCents)],
    ],
    styles: { fontSize: 9, cellPadding: 2.2, halign: "right" },
    columnStyles: { 0: { halign: "left", fontStyle: "bold" } },
    theme: "plain",
  });

  if (doc.kind === "Invoice" && doc.payments.length > 0) {
    autoTable(pdf, {
      startY: (pdf as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
        ? (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6
        : 80,
      head: [["Payments", "Method", "Reference", "Amount"]],
      body: doc.payments.map((payment) => [
        dateLabel(payment.paidAt),
        payment.method,
        payment.reference || "-",
        money(payment.amountCents),
      ]),
      foot: [["", "", "Balance due", money(doc.outstandingCents)]],
      styles: { fontSize: 9, cellPadding: 2.2 },
      headStyles: { fillColor: [30, 41, 59], textColor: [245, 158, 11] },
      footStyles: { fillColor: [245, 158, 11], textColor: [15, 23, 42], fontStyle: "bold" },
      columnStyles: { 3: { halign: "right" } },
    });
  }

  pdf.setFontSize(8);
  pdf.setTextColor(100, 116, 139);
  const footer = doc.kind === "Quote"
    ? `Quotation ${doc.number} — prices valid until ${dateLabel(doc.dueDate) || "further notice"}.`
    : `VAT invoice ${doc.number} — VAT rate ${doc.vatRate}% (snapshot at issue). Thank you for your business.`;
  pdf.text(footer, 14, 287);
  pdf.save(`${doc.number}.pdf`);
}

/**
 * Searchable stock picker for one draft line's description. Clicking opens the
 * stock list; typing filters it by item name, SKU, category or unit. Choosing
 * an item stores the inventory link plus the name/SKU description snapshot and
 * never touches the quantity or the unit price. Typing instead of choosing is
 * a custom service/fee line; editing or unlinking clears the stock link.
 */
export function StockPicker({
  line, index, items, status, onChange,
}: {
  line: DraftLine; index: number; items: StockItem[]; status: StockStatus;
  onChange: (patch: Partial<DraftLine>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const linked = line.inventoryItemId === null
    ? null
    : items.find((item) => item.id === line.inventoryItemId) ?? null;
  const query = stockPickerQuery(line.description, linked);
  const matches = useMemo(() => filterStockItems(items, query), [items, query]);
  const active = Math.min(highlight, Math.max(0, matches.length - 1));
  const listId = `stock-list-${index}`;

  const pick = (item: StockItem) => {
    onChange({ inventoryItemId: item.id, description: stockLineDescription(item) });
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlight(Math.min(active + 1, matches.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlight(Math.max(active - 1, 0));
    } else if (event.key === "Enter" && open && matches[active]) {
      event.preventDefault(); // never submit the whole document from the picker
      pick(matches[active]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div
      className="relative min-w-0 flex-[3]"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}
    >
      <span className={labelClass}>
        Description * <span className="normal-case tracking-normal text-slate-500">— search stock or type a service/fee</span>
      </span>
      <input
        required
        className={inputClass}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        maxLength={MAX_LINE_DESCRIPTION}
        value={line.description}
        placeholder="Search by name, SKU, category or unit…"
        onFocus={() => { setOpen(true); setHighlight(0); }}
        onChange={(event) => {
          const description = event.target.value;
          const keepLink = linked !== null && description.trim() === stockLineDescription(linked);
          onChange({ description, inventoryItemId: keepLink ? line.inventoryItemId : null });
          setOpen(true);
          setHighlight(0);
        }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div id={listId} role="listbox" aria-label="Stock items" className="absolute left-0 right-0 z-[95] mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-700 bg-slate-950 shadow-2xl">
          {status === "loading" && <div className="px-3 py-2 text-[11px] text-slate-400">Loading the stock list…</div>}
          {status === "error" && <div className="px-3 py-2 text-[11px] text-amber-300">Stock list unavailable — type a custom description instead.</div>}
          {status === "ready" && matches.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-slate-500">No stock item matches — keep typing to use this as a custom description.</div>
          )}
          {matches.map((item, position) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={item.id === line.inventoryItemId}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setHighlight(position)}
              onClick={() => pick(item)}
              className={`block w-full px-3 py-1.5 text-left text-xs transition ${position === active ? "bg-amber-500/15" : ""}`}
            >
              <span className="font-bold text-white">{item.name}</span>
              <span className="ml-1.5 font-mono text-[10px] text-amber-300">{item.sku}</span>
              <span className="block text-[10px] text-slate-500">{item.category} · {item.unit}</span>
            </button>
          ))}
          {status === "ready" && matches.length === MAX_STOCK_PICKER_RESULTS && (
            <div className="border-t border-slate-800 px-3 py-1.5 text-[10px] text-slate-600">Showing the first {MAX_STOCK_PICKER_RESULTS} matches — keep typing to narrow it down.</div>
          )}
        </div>
      )}
      {line.inventoryItemId !== null ? (
        <span className="mt-1 flex flex-wrap items-center gap-2 text-[10px]">
          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-black text-emerald-300">
            Linked to stock{linked ? ` · ${linked.sku}` : ""}
          </span>
          <button type="button" className="text-slate-500 underline hover:text-rose-300"
            onClick={() => onChange({ inventoryItemId: null })}>
            Unlink (keep as custom text)
          </button>
        </span>
      ) : (
        <span className="mt-1 block text-[10px] text-slate-500">Custom service/fee line — or pick a stock item above.</span>
      )}
    </div>
  );
}

export default function InvoicingView() {
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [tab, setTab] = useState<"document" | "aging">("document");
  const [filter, setFilter] = useState<"all" | "Quote" | "Invoice" | "outstanding">("all");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<DocDraft | null>(null);
  const [payFor, setPayFor] = useState<Doc | null>(null);
  const [payForm, setPayForm] = useState({ amount: "", paidAt: "", method: "Cash", reference: "", notes: "" });
  const [convertFor, setConvertFor] = useState<Doc | null>(null);
  const [convertDue, setConvertDue] = useState("");
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [stockStatus, setStockStatus] = useState<StockStatus>("idle");
  const stockLoading = useRef(false);

  // Identity-only stock list for the line pickers (the route behind the same
  // Invoicing & Money grant never returns costs or quantities). Reloaded each
  // time a draft opens so renamed items stay current; a failure just leaves
  // the picker to plain custom descriptions.
  const loadStockItems = async () => {
    if (stockLoading.current) return;
    stockLoading.current = true;
    setStockStatus("loading");
    try {
      const data = await send("/api/invoicing/stock-items", "GET");
      setStockItems(Array.isArray(data?.items) ? (data.items as StockItem[]) : []);
      setStockStatus("ready");
    } catch {
      setStockStatus("error");
    } finally {
      stockLoading.current = false;
    }
  };

  const refresh = async () => {
    try {
      const res = await fetch("/api/invoicing", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load invoicing.");
      setBoard(data as Board);
      setError("");
    } catch (cause) {
      setBoard(null); // never retain a previous user's financial data after a 403
      setError(cause instanceof Error ? cause.message : "Could not load invoicing.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const documents = useMemo(() => {
    const rows = board?.documents ?? [];
    const needle = search.trim().toLowerCase();
    return rows.filter((doc) => {
      if (filter === "Quote" && doc.kind !== "Quote") return false;
      if (filter === "Invoice" && doc.kind !== "Invoice") return false;
      if (filter === "outstanding" && !(doc.kind === "Invoice" && doc.status === "Open" && doc.outstandingCents > 0)) return false;
      if (!needle) return true;
      return [doc.number, doc.customerName, doc.customerCompany, doc.notes]
        .some((value) => String(value ?? "").toLowerCase().includes(needle));
    });
  }, [board, filter, search]);

  const selected = board?.documents.find((doc) => doc.id === selectedId) ?? null;
  const totals = useMemo(() => {
    const live = (board?.documents ?? []).filter((doc) => doc.kind === "Invoice" && doc.status === "Open");
    const outstandingCents = live.reduce((sum, doc) => sum + doc.outstandingCents, 0);
    const overdueCents = live.reduce((sum, doc) => sum + ((doc.overdueDays ?? 0) > 0 ? doc.outstandingCents : 0), 0);
    const openQuotes = (board?.documents ?? []).filter((doc) => doc.kind === "Quote" && doc.status === "Open").length;
    return { outstandingCents, overdueCents, openQuotes, openInvoices: live.length };
  }, [board]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setNotice("");
    try {
      await fn();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };

  const createDocument = (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    void run(async () => {
      const created = await send("/api/invoicing", "POST", {
        kind: draft.kind,
        customerId: Number(draft.customerId),
        issueDate: draft.issueDate,
        dueDate: draft.dueDate || null,
        vatRate: draft.vatRate,
        notes: draft.notes,
        lines: draft.lines.map((line) => ({
          inventoryItemId: line.inventoryItemId,
          description: line.description,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      });
      setDraft(null);
      setSelectedId(created.id);
      setTab("document");
      setNotice(`${created.number} created.`);
      await refresh();
    });
  };

  const recordPayment = (event: FormEvent) => {
    event.preventDefault();
    if (!payFor) return;
    void run(async () => {
      await send(`/api/invoicing/${payFor.id}/payments`, "POST", {
        amount: payForm.amount,
        paidAt: payForm.paidAt,
        method: payForm.method,
        reference: payForm.reference,
        notes: payForm.notes,
      });
      setPayFor(null);
      setNotice(`Payment recorded on ${payFor.number}.`);
      await refresh();
    });
  };

  const convert = () => {
    if (!convertFor) return;
    void run(async () => {
      const created = await send(`/api/invoicing/${convertFor.id}/convert`, "POST", { dueDate: convertDue || null });
      setConvertFor(null);
      setSelectedId(created.id);
      setNotice(`${convertFor.number} converted to ${created.number}.`);
      await refresh();
    });
  };

  const cancelDoc = (doc: Doc) => {
    const question = doc.kind === "Quote"
      ? `Cancel quotation ${doc.number}? Its number stays reserved.`
      : `Cancel invoice ${doc.number}? It must have no recorded payments. Its number stays reserved.`;
    if (!window.confirm(question)) return;
    void run(async () => {
      await send(`/api/invoicing/${doc.id}/cancel`, "POST");
      setNotice(`${doc.number} cancelled.`);
      await refresh();
    });
  };

  const deletePayment = (payment: Payment, doc: Doc) => {
    if (!window.confirm(`Delete this ${money(payment.amountCents)} payment from ${doc.number}? The amount returns to outstanding.`)) return;
    void run(async () => {
      await send(`/api/invoicing/payments/${payment.id}`, "DELETE");
      setNotice("Payment deleted.");
      await refresh();
    });
  };

  const updateDraftLine = (index: number, patch: Partial<DraftLine>) => {
    if (!draft) return;
    setDraft({ ...draft, lines: draft.lines.map((line, i) => (i === index ? { ...line, ...patch } : line)) });
  };

  const openDraft = (kind: DocumentKind) => {
    setNotice("");
    setDraft(emptyDraft(kind, board?.today ?? new Date().toISOString().slice(0, 10)));
    void loadStockItems();
  };

  const draftTotals = useMemo(() => {
    if (!draft) return null;
    let subtotal = 0;
    for (const line of draft.lines) {
      const qty = Number(line.quantity);
      const price = Number(line.unitPrice);
      if (Number.isFinite(qty) && Number.isFinite(price)) subtotal += Math.round(qty * price * 100);
    }
    const rate = Number(draft.vatRate);
    const vat = Number.isFinite(rate) ? Math.round((subtotal * rate * 100) / 10_000) : 0;
    return { subtotal, vat, total: subtotal + vat };
  }, [draft]);

  if (loading) {
    return <div className="p-10 text-center text-sm text-slate-500 animate-pulse">Loading invoicing…</div>;
  }
  if (error && !board) {
    return (
      <div className="m-6 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-6 text-sm text-rose-200">
        {error}
        <button className={`${secondaryClass} mt-4`} onClick={() => { setLoading(true); void refresh(); }}>Retry</button>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-black text-white"><Receipt className="h-6 w-6 text-amber-400" /> Invoicing &amp; A/R</h1>
          <p className="text-xs text-slate-400">Quotations, VAT invoices (11% Lebanon), payments and receivables per client.</p>
        </div>
        <div className="flex items-center gap-2">
          <button className={secondaryClass} onClick={() => void refresh()} disabled={busy}><RefreshCw className="inline h-3.5 w-3.5" /> Refresh</button>
          <button className={secondaryClass} onClick={() => openDraft("Quote")} disabled={busy || (board?.customers.length ?? 0) === 0}><Plus className="inline h-3.5 w-3.5" /> New quotation</button>
          <button className={primaryClass} onClick={() => openDraft("Invoice")} disabled={busy || (board?.customers.length ?? 0) === 0}><Plus className="inline h-3.5 w-3.5" /> New invoice</button>
        </div>
      </div>

      {notice && <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-bold text-emerald-300">{notice}</div>}
      {error && board && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-bold text-rose-300">{error}</div>}
      {(board?.customers.length ?? 0) === 0 && <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs font-bold text-amber-300">Add a client in Clients &amp; Architects before creating documents.</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          { label: "Outstanding A/R", value: money(totals.outstandingCents), sub: `${totals.openInvoices} open invoice${totals.openInvoices === 1 ? "" : "s"}`, Icon: Banknote, tone: "text-rose-300" },
          { label: "Overdue", value: money(totals.overdueCents), sub: "past due date", Icon: Undo2, tone: "text-amber-300" },
          { label: "Open quotations", value: String(totals.openQuotes), sub: "awaiting decision", Icon: FileText, tone: "text-sky-300" },
          { label: "Clients", value: String(board?.customers.length ?? 0), sub: "on the books", Icon: Users, tone: "text-emerald-300" },
        ].map(({ label, value, sub, Icon, tone }) => (
          <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-slate-500"><Icon className="h-3.5 w-3.5" /> {label}</div>
            <div className={`mt-1 font-mono text-lg font-black ${tone}`}>{value}</div>
            <div className="text-[10px] text-slate-500">{sub}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number, client, notes…" className={`${inputClass} pl-9`} />
            </div>
            <div className="flex gap-1 rounded-xl border border-slate-700 bg-slate-950 p-1">
              {([["all", "All"], ["Invoice", "Invoices"], ["Quote", "Quotes"], ["outstanding", "Outstanding"]] as const).map(([key, label]) => (
                <button key={key} type="button" onClick={() => setFilter(key)} className={`rounded-lg px-2.5 py-1.5 text-[11px] font-black transition ${filter === key ? "bg-amber-500/20 text-amber-300" : "text-slate-400 hover:text-white"}`}>{label}</button>
              ))}
            </div>
          </div>
          <div className="max-h-[68vh] space-y-2 overflow-y-auto pr-1">
            {documents.length === 0 && <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-6 text-center text-xs text-slate-500">No documents match.</div>}
            {documents.map((doc) => (
              <button
                key={doc.id}
                onClick={() => { setSelectedId(doc.id); setTab("document"); }}
                className={`block w-full rounded-xl border p-3 text-left transition ${selectedId === doc.id ? "border-amber-500/70 bg-amber-500/10" : "border-slate-800 bg-slate-900/60 hover:border-slate-600"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-black text-white">{doc.number}</span>
                  {stateBadge(doc)}
                </div>
                <div className="mt-1 truncate text-xs text-slate-300">{doc.customerCompany || doc.customerName}</div>
                <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                  <span>{doc.kind === "Quote" ? "Quote" : "Invoice"} · {dateLabel(doc.issueDate)}</span>
                  <span className="font-mono font-black text-white">{money(doc.totalCents)}</span>
                </div>
                {doc.kind === "Invoice" && doc.status !== "Cancelled" && (
                  <div className="mt-0.5 text-[10px] text-slate-500">
                    Paid {money(doc.paidCents)} · due {money(doc.outstandingCents)}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex gap-1 rounded-xl border border-slate-700 bg-slate-950 p-1">
            <button type="button" onClick={() => setTab("document")} className={`flex-1 rounded-lg px-3 py-1.5 text-[11px] font-black transition ${tab === "document" ? "bg-amber-500/20 text-amber-300" : "text-slate-400 hover:text-white"}`}>Document</button>
            <button type="button" onClick={() => setTab("aging")} className={`flex-1 rounded-lg px-3 py-1.5 text-[11px] font-black transition ${tab === "aging" ? "bg-amber-500/20 text-amber-300" : "text-slate-400 hover:text-white"}`}>A/R aging</button>
          </div>

          {tab === "aging" ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <h2 className="text-sm font-black text-white">Receivables per client</h2>
              <p className="text-[11px] text-slate-500">Unpaid invoice remainders, bucketed by days past the due date.</p>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead>
                    <tr className="text-slate-500">
                      <th className="py-1 text-left font-bold">Client</th>
                      {AGING_BUCKETS.map((bucket) => <th key={bucket} className="py-1 text-right font-bold">{AGING_LABELS[bucket]}</th>)}
                      <th className="py-1 text-right font-bold">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(board?.aging ?? []).length === 0 && (
                      <tr><td colSpan={7} className="py-6 text-center text-slate-600">Nothing outstanding.</td></tr>
                    )}
                    {(board?.aging ?? []).map((row) => (
                      <tr key={row.customerId} className="border-t border-slate-800">
                        <td className="py-1.5 pr-2 text-slate-200">{row.company || row.name}</td>
                        {AGING_BUCKETS.map((bucket) => (
                          <td key={bucket} className={`py-1.5 text-right font-mono ${bucket === "current" ? "text-slate-300" : row.buckets[bucket] > 0 ? "text-rose-300" : "text-slate-600"}`}>
                            {row.buckets[bucket] > 0 ? money(row.buckets[bucket]) : "—"}
                          </td>
                        ))}
                        <td className="py-1.5 text-right font-mono font-black text-white">{money(row.totalCents)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-700 font-black text-white">
                      <td className="py-2">TOTAL</td>
                      {AGING_BUCKETS.map((bucket) => (
                        <td key={bucket} className="py-2 text-right font-mono">
                          {money((board?.aging ?? []).reduce((sum, row) => sum + row.buckets[bucket], 0))}
                        </td>
                      ))}
                      <td className="py-2 text-right font-mono">{money((board?.aging ?? []).reduce((sum, row) => sum + row.totalCents, 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : !selected ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-10 text-center text-xs text-slate-500">Select a document to see its lines, totals and payments.</div>
          ) : (
            <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-800 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="font-mono text-lg font-black text-white">{selected.number}</h2>
                    {stateBadge(selected)}
                  </div>
                  <div className="mt-1 text-sm text-slate-200">{selected.customerCompany || selected.customerName}</div>
                  {selected.customerCompany && <div className="text-xs text-slate-500">{selected.customerName}</div>}
                  <div className="mt-1 text-[11px] text-slate-500">
                    Issued {dateLabel(selected.issueDate)} · {selected.kind === "Quote" ? "valid until" : "due"} {dateLabel(selected.dueDate)}
                    {selected.convertedFromId ? " · converted from a quotation" : ""}
                  </div>
                  {selected.notes && <div className="mt-1 max-w-md break-words text-[11px] text-slate-400">{selected.notes}</div>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button className={secondaryClass} onClick={() => exportPdf(selected)}><FileDown className="inline h-3.5 w-3.5" /> PDF</button>
                  {selected.kind === "Quote" && selected.status === "Open" && (
                    <button className={primaryClass} disabled={busy} onClick={() => { setConvertDue(""); setConvertFor(selected); }}>
                      <ArrowRight className="inline h-3.5 w-3.5" /> Convert to invoice
                    </button>
                  )}
                  {selected.kind === "Invoice" && selected.status === "Open" && (
                    <button className={primaryClass} disabled={busy} onClick={() => {
                      setPayForm({
                        amount: (selected.outstandingCents / 100).toFixed(2),
                        paidAt: board?.today ?? "",
                        method: "Cash", reference: "", notes: "",
                      });
                      setPayFor(selected);
                    }}>
                      <Banknote className="inline h-3.5 w-3.5" /> Record payment
                    </button>
                  )}
                  {selected.status === "Open" && (
                    <button className={secondaryClass} disabled={busy} onClick={() => cancelDoc(selected)}><Trash2 className="inline h-3.5 w-3.5" /> Cancel</button>
                  )}
                </div>
              </div>

              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500">
                    <th className="py-1 text-left font-bold">Description</th>
                    <th className="py-1 text-right font-bold">Qty</th>
                    <th className="py-1 text-right font-bold">Unit price</th>
                    <th className="py-1 text-right font-bold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.lines.map((line) => (
                    <tr key={line.id} className="border-t border-slate-800">
                      <td className="py-1.5 pr-2 text-slate-200">
                        {line.description}
                        {line.inventoryItemId !== null && (
                          <span className="ml-1.5 rounded bg-emerald-500/15 px-1 py-0.5 text-[9px] font-black text-emerald-300" title="Linked to a stock item">stock</span>
                        )}
                      </td>
                      <td className="py-1.5 text-right font-mono text-slate-300">{line.quantity}</td>
                      <td className="py-1.5 text-right font-mono text-slate-300">{money(line.unitPriceCents)}</td>
                      <td className="py-1.5 text-right font-mono font-bold text-white">{money(line.lineTotalCents)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-700 text-slate-300">
                    <td colSpan={3} className="py-1.5 text-right">Subtotal</td>
                    <td className="py-1.5 text-right font-mono">{money(selected.subtotalCents)}</td>
                  </tr>
                  <tr className="text-slate-300">
                    <td colSpan={3} className="py-1 text-right">VAT {selected.vatRate}%</td>
                    <td className="py-1 text-right font-mono">{money(selected.vatCents)}</td>
                  </tr>
                  <tr className="text-amber-300">
                    <td colSpan={3} className="py-1.5 text-right font-black">TOTAL</td>
                    <td className="py-1.5 text-right font-mono font-black">{money(selected.totalCents)}</td>
                  </tr>
                </tbody>
              </table>

              {selected.kind === "Invoice" && selected.status !== "Cancelled" && (
                <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-400">Payments</h3>
                    <span className="text-[11px] text-slate-500">
                      Paid {money(selected.paidCents)} · <span className={selected.outstandingCents > 0 ? "font-black text-rose-300" : "font-black text-emerald-300"}>due {money(selected.outstandingCents)}</span>
                    </span>
                  </div>
                  {selected.payments.length === 0 ? (
                    <p className="mt-2 text-[11px] text-slate-600">No payments recorded yet.</p>
                  ) : (
                    <div className="mt-2 space-y-1.5">
                      {selected.payments.map((payment) => (
                        <div key={payment.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-2.5 py-1.5">
                          <div className="min-w-0 text-[11px] text-slate-400">
                            <span className="font-mono font-black text-emerald-300">{money(payment.amountCents)}</span>
                            {" · "}{dateLabel(payment.paidAt)} · {payment.method}
                            {payment.reference ? ` · ${payment.reference}` : ""}
                            {payment.notes ? ` · ${payment.notes}` : ""}
                          </div>
                          <button onClick={() => deletePayment(payment, selected)} className="rounded-lg p-1.5 text-slate-600 transition hover:bg-rose-500/20 hover:text-rose-400" title="Delete payment (correction)">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {draft && (
        <Modal title={draft.kind === "Quote" ? "New quotation" : "New VAT invoice"} onClose={() => setDraft(null)}>
          <form onSubmit={createDocument} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="sm:col-span-2">
                <span className={labelClass}>Client *</span>
                <select required className={inputClass} value={draft.customerId} onChange={(e) => setDraft({ ...draft, customerId: e.target.value })}>
                  <option value="">Select a client…</option>
                  {board?.customers.map((client) => <option key={client.id} value={client.id}>{client.company || client.name}</option>)}
                </select>
              </label>
              <label>
                <span className={labelClass}>VAT rate (%)</span>
                <input className={inputClass} value={draft.vatRate} onChange={(e) => setDraft({ ...draft, vatRate: e.target.value })} placeholder={LEBANON_VAT_RATE} />
              </label>
              <label>
                <span className={labelClass}>Issue date *</span>
                <input required type="date" className={inputClass} value={draft.issueDate} onChange={(e) => setDraft({ ...draft, issueDate: e.target.value })} />
              </label>
              <label>
                <span className={labelClass}>{draft.kind === "Quote" ? "Valid until" : "Due date"}</span>
                <input type="date" className={inputClass} value={draft.dueDate} onChange={(e) => setDraft({ ...draft, dueDate: e.target.value })} />
              </label>
              <label>
                <span className={labelClass}>Notes</span>
                <input className={inputClass} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Terms, deposit stage…" />
              </label>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-400">Lines</h3>
                <button type="button" className={secondaryClass} disabled={draft.lines.length >= 50}
                  onClick={() => setDraft({ ...draft, lines: [...draft.lines, emptyLine()] })}>
                  <Plus className="inline h-3.5 w-3.5" /> Add line
                </button>
              </div>
              {draft.lines.map((line, index) => (
                <div key={index} className="flex flex-wrap items-start gap-2 rounded-xl border border-slate-800 bg-slate-950/50 p-2">
                  <StockPicker
                    line={line}
                    index={index}
                    items={stockItems}
                    status={stockStatus}
                    onChange={(patch) => updateDraftLine(index, patch)}
                  />
                  <label className="w-24">
                    <span className={labelClass}>Qty *</span>
                    <input required type="number" step="0.01" min="0.01" className={inputClass} value={line.quantity}
                      onChange={(e) => updateDraftLine(index, { quantity: e.target.value })} />
                  </label>
                  <label className="w-32">
                    <span className={labelClass}>Unit price ($) *</span>
                    <input required type="number" step="0.01" min="0" className={inputClass} value={line.unitPrice}
                      onChange={(e) => updateDraftLine(index, { unitPrice: e.target.value })} />
                  </label>
                  <button type="button" className="mt-[18px] rounded-lg p-2 text-slate-600 transition hover:bg-rose-500/20 hover:text-rose-400 disabled:opacity-30"
                    disabled={draft.lines.length <= 1}
                    onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_, i) => i !== index) })}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {draftTotals && (
              <div className="flex justify-end gap-6 text-sm">
                <div className="text-right text-slate-400">Subtotal <span className="ml-2 font-mono text-white">{money(draftTotals.subtotal)}</span></div>
                <div className="text-right text-slate-400">VAT <span className="ml-2 font-mono text-white">{money(draftTotals.vat)}</span></div>
                <div className="text-right font-black text-amber-300">TOTAL <span className="ml-2 font-mono">{money(draftTotals.total)}</span></div>
              </div>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
              <button type="button" className={secondaryClass} onClick={() => setDraft(null)}>Cancel</button>
              <button type="submit" className={primaryClass} disabled={busy}>Create {draft.kind.toLowerCase()}</button>
            </div>
          </form>
        </Modal>
      )}

      {payFor && (
        <Modal title={`Record payment — ${payFor.number}`} onClose={() => setPayFor(null)}>
          <form onSubmit={recordPayment} className="space-y-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3 text-xs text-slate-400">
              Total {money(payFor.totalCents)} · already paid {money(payFor.paidCents)} ·
              <span className="font-black text-rose-300"> outstanding {money(payFor.outstandingCents)}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className={labelClass}>Amount ($) *</span>
                <input required type="number" step="0.01" min="0.01" max={(payFor.outstandingCents / 100).toFixed(2)} className={inputClass} value={payForm.amount}
                  onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
              </label>
              <label>
                <span className={labelClass}>Payment date *</span>
                <input required type="date" className={inputClass} value={payForm.paidAt} onChange={(e) => setPayForm({ ...payForm, paidAt: e.target.value })} />
              </label>
              <label>
                <span className={labelClass}>Method</span>
                <select className={inputClass} value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })}>
                  {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{method}</option>)}
                </select>
              </label>
              <label>
                <span className={labelClass}>Reference</span>
                <input className={inputClass} value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="Check #, transfer ref…" />
              </label>
              <label className="sm:col-span-2">
                <span className={labelClass}>Notes</span>
                <input className={inputClass} value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
              <button type="button" className={secondaryClass} onClick={() => setPayFor(null)}>Cancel</button>
              <button type="submit" className={primaryClass} disabled={busy}>Record payment</button>
            </div>
          </form>
        </Modal>
      )}

      {convertFor && (
        <Modal title={`Convert ${convertFor.number} to a VAT invoice`} onClose={() => setConvertFor(null)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-300">
              A new invoice is issued with the same lines and VAT rate ({convertFor.vatRate}%). The quotation is then marked converted and stays in history.
            </p>
            <label className="block">
              <span className={labelClass}>Due date (payment terms)</span>
              <input type="date" className={inputClass} value={convertDue} onChange={(e) => setConvertDue(e.target.value)} />
              <span className="mt-1 block text-[11px] text-slate-500">Leave empty for 30-day terms from today.</span>
            </label>
            <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
              <button type="button" className={secondaryClass} onClick={() => setConvertFor(null)}>Cancel</button>
              <button type="button" className={primaryClass} disabled={busy} onClick={convert}>Issue invoice</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
