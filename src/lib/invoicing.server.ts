// Invoicing & A/R persistence (server only). Quotations and invoices are
// immutable once created — only payments, conversion and cancellation change
// them — and the legal number is reserved in the creating transaction so a
// rolled-back document takes its number with it (no gaps).
import { db } from "@/db";
import { customers, documentCounters, inventoryItems, invoiceLines, invoicePayments, invoices } from "@/db/schema";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  InvoicingError, addDaysIso, agingBucketFor, daysPastDue, documentNumber, emptyAging,
  moneyFromCents, optionalDateOnly, parseDocument, parsePayment, paymentState, seriesFor,
  stockIdentity, stockLineDescription, todayIso, vatRateFromBps,
  type AgingBucket, type DocumentKind, type DocumentSeries, type StockIdentity,
} from "@/lib/invoicing";
import { ensureInvoicingSchema } from "@/lib/invoicingSchema.server";
import { syncCustomerBalance } from "@/lib/clientLedger.server";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Gapless per-year numbering: one counter row per series, bumped atomically. */
async function nextNumber(tx: Tx, series: DocumentSeries, year: number): Promise<string> {
  const [row] = await tx.insert(documentCounters)
    .values({ series, year, lastNumber: 1 })
    .onConflictDoUpdate({
      target: [documentCounters.series, documentCounters.year],
      set: { lastNumber: sql`${documentCounters.lastNumber} + 1` },
    })
    .returning({ lastNumber: documentCounters.lastNumber });
  return documentNumber(series, year, row.lastNumber);
}

async function paidCentsFor(tx: Tx, invoiceId: number): Promise<number> {
  const rows = await tx.select({ amountCents: invoicePayments.amountCents })
    .from(invoicePayments).where(eq(invoicePayments.invoiceId, invoiceId));
  return rows.reduce((sum, row) => sum + row.amountCents, 0);
}

/**
 * Picker list for the line description dropdown: stock identity only. Costs,
 * quantities, reorder levels and locations are never selected, so they cannot
 * leak to the invoicing screen.
 */
export async function listStockIdentity(): Promise<StockIdentity[]> {
  const rows = await db.select({
    id: inventoryItems.id, sku: inventoryItems.sku, name: inventoryItems.name,
    category: inventoryItems.category, unit: inventoryItems.unit,
  }).from(inventoryItems).orderBy(asc(inventoryItems.name), asc(inventoryItems.sku));
  return rows.map(stockIdentity);
}

/**
 * Server-side validation of picked stock ids — the client is never trusted.
 * Returns the identity rows for the ids that exist.
 */
async function stockIdentityById(tx: Tx, ids: number[]): Promise<Map<number, StockIdentity>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await tx.select({
    id: inventoryItems.id, sku: inventoryItems.sku, name: inventoryItems.name,
    category: inventoryItems.category, unit: inventoryItems.unit,
  }).from(inventoryItems).where(inArray(inventoryItems.id, unique));
  return new Map(rows.map((row) => [row.id, stockIdentity(row)]));
}

/** Human message shared by every refused link. */
const STOCK_GONE = "A selected stock item no longer exists. Refresh the stock list and pick it again.";

export async function invoicingBoard() {
  await ensureInvoicingSchema();
  // One repeatable-read snapshot on a single connection (pg@9 rejects parallel
  // queries per client): a receipt-side effect can never halve a document.
  const [invoiceRows, lineRows, paymentRows, customerRows] = await db.transaction(async (tx) => {
    const invoiceRows = await tx.select().from(invoices)
      .orderBy(desc(invoices.issueDate), desc(invoices.id));
    const lineRows = await tx.select().from(invoiceLines);
    const paymentRows = await tx.select().from(invoicePayments).orderBy(asc(invoicePayments.paidAt), asc(invoicePayments.id));
    const customerRows = await tx.select({
      id: customers.id, name: customers.name, company: customers.company,
      creditLimit: customers.creditLimit, currentBalance: customers.currentBalance,
    }).from(customers).orderBy(asc(customers.company), asc(customers.name));
    return [invoiceRows, lineRows, paymentRows, customerRows] as const;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });

  const today = todayIso();
  const linesByInvoice = new Map<number, typeof lineRows>();
  for (const line of lineRows) {
    const list = linesByInvoice.get(line.invoiceId) ?? [];
    list.push(line);
    linesByInvoice.set(line.invoiceId, list);
  }
  const paymentsByInvoice = new Map<number, typeof paymentRows>();
  for (const payment of paymentRows) {
    const list = paymentsByInvoice.get(payment.invoiceId) ?? [];
    list.push(payment);
    paymentsByInvoice.set(payment.invoiceId, list);
  }

  const documents = invoiceRows.map((row) => {
    const lines = linesByInvoice.get(row.id) ?? [];
    const payments = paymentsByInvoice.get(row.id) ?? [];
    const paidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
    const live = row.kind === "Invoice" && row.status !== "Cancelled";
    const outstandingCents = live ? Math.max(0, row.totalCents - paidCents) : 0;
    return {
      ...row,
      vatRate: row.vatRate,
      lines,
      payments,
      paidCents,
      outstandingCents,
      paymentState: live ? paymentState(row.totalCents, paidCents) : null,
      overdueDays: live && outstandingCents > 0 ? daysPastDue(row.dueDate, today) : null,
    };
  });

  // A/R aging: unpaid remainder of live invoices, bucketed by days past due.
  const agingByCustomer = new Map<number, Record<AgingBucket, number>>();
  for (const doc of documents) {
    if (doc.kind !== "Invoice" || doc.status !== "Open" || doc.outstandingCents <= 0 || doc.customerId == null) continue;
    const buckets = agingByCustomer.get(doc.customerId) ?? emptyAging();
    buckets[agingBucketFor(doc.dueDate, today)] += doc.outstandingCents;
    agingByCustomer.set(doc.customerId, buckets);
  }
  const nameByCustomer = new Map(customerRows.map((row) => [row.id, row]));
  const aging = [...agingByCustomer.entries()]
    .map(([customerId, buckets]) => {
      const totalCents = Object.values(buckets).reduce((sum, value) => sum + value, 0);
      const overdueCents = totalCents - buckets.current;
      return {
        customerId,
        name: nameByCustomer.get(customerId)?.name ?? "Client unavailable",
        company: nameByCustomer.get(customerId)?.company ?? "",
        buckets,
        totalCents,
        overdueCents,
      };
    })
    .sort((a, b) => b.totalCents - a.totalCents);

  return { documents, customers: customerRows, aging, today, canSeeMoney: true };
}

export async function createDocument(kind: DocumentKind, input: unknown, createdById: number) {
  const payload = parseDocument(kind, input);
  if (payload.dueDate && payload.dueDate < payload.issueDate) {
    throw new InvoicingError("Due date cannot be before the issue date.");
  }
  await ensureInvoicingSchema();
  const created = await db.transaction(async (tx) => {
    const [customer] = await tx.select({ id: customers.id, name: customers.name, company: customers.company })
      .from(customers).where(eq(customers.id, payload.customerId)).for("share");
    if (!customer) throw new InvoicingError("Client not found. Refresh and try again.", 409);
    // Every picked id must still exist; the description snapshot then comes
    // from the item itself, never from the request body.
    const picked = payload.lines.flatMap((line) => (line.inventoryItemId === null ? [] : [line.inventoryItemId]));
    const stockItems = await stockIdentityById(tx, picked);
    if (stockItems.size !== new Set(picked).size) throw new InvoicingError(STOCK_GONE, 409);
    const number = await nextNumber(tx, seriesFor(kind), Number(payload.issueDate.slice(0, 4)));
    const [doc] = await tx.insert(invoices).values({
      kind,
      number,
      customerId: customer.id,
      customerName: customer.name,
      customerCompany: customer.company,
      issueDate: payload.issueDate,
      dueDate: payload.dueDate,
      status: "Open",
      vatRate: vatRateFromBps(payload.vatRateBps),
      subtotalCents: payload.subtotalCents,
      vatCents: payload.vatCents,
      totalCents: payload.totalCents,
      notes: payload.notes,
      createdById,
    }).returning({ id: invoices.id, number: invoices.number });
    await tx.insert(invoiceLines).values(payload.lines.map((line) => {
      const item = line.inventoryItemId === null ? null : stockItems.get(line.inventoryItemId) ?? null;
      return {
        invoiceId: doc.id,
        inventoryItemId: item ? item.id : null,
        // Picking the item is enough: the server writes the name/SKU snapshot
        // when the text was left empty. Prices and stock are never touched.
        description: line.description || (item ? stockLineDescription(item) : ""),
        quantity: moneyFromCents(line.quantityHundredths),
        unitPriceCents: line.unitPriceCents,
        lineTotalCents: line.lineTotalCents,
      };
    }));
    return { id: doc.id, number: doc.number, kind };
  });
  if (kind === "Invoice") await syncCustomerBalance(payload.customerId);
  return created;
}

export async function convertQuote(id: number, input: unknown, createdById: number) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const requestedDue = optionalDateOnly(raw.dueDate, "Due date");
  await ensureInvoicingSchema();
  return db.transaction(async (tx) => {
    // Lock the quote first: a double-click convert serializes here.
    const [quote] = await tx.select().from(invoices).where(eq(invoices.id, id)).for("update");
    if (!quote) throw new InvoicingError("Quotation not found.", 404);
    if (quote.kind !== "Quote") throw new InvoicingError("Only quotations convert to invoices.", 400);
    if (quote.status !== "Open") throw new InvoicingError("This quotation is already converted or cancelled.", 409);
    const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));
    // The quote's stock links convert with it. An item deleted in the meantime
    // only drops its link (same rule as the FK): the snapshot text stays.
    const stockItems = await stockIdentityById(
      tx,
      lines.flatMap((line) => (line.inventoryItemId === null ? [] : [line.inventoryItemId])),
    );
    const issueDate = todayIso();
    const dueDate = requestedDue ?? addDaysIso(issueDate, 30);
    if (dueDate < issueDate) throw new InvoicingError("Due date cannot be before the issue date.");
    const number = await nextNumber(tx, "INV", Number(issueDate.slice(0, 4)));
    const [doc] = await tx.insert(invoices).values({
      kind: "Invoice",
      number,
      customerId: quote.customerId,
      customerName: quote.customerName,
      customerCompany: quote.customerCompany,
      issueDate,
      dueDate,
      status: "Open",
      vatRate: quote.vatRate,
      subtotalCents: quote.subtotalCents,
      vatCents: quote.vatCents,
      totalCents: quote.totalCents,
      notes: quote.notes,
      convertedFromId: quote.id,
      createdById,
    }).returning({ id: invoices.id, number: invoices.number });
    await tx.insert(invoiceLines).values(lines.map((line) => ({
      invoiceId: doc.id,
      inventoryItemId: line.inventoryItemId !== null && stockItems.has(line.inventoryItemId)
        ? line.inventoryItemId
        : null,
      description: line.description,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      lineTotalCents: line.lineTotalCents,
    })));
    await tx.update(invoices).set({ status: "Converted" }).where(eq(invoices.id, id));
    return { id: doc.id, number: doc.number, kind: "Invoice" as const, from: quote.number };
  });
}

export async function recordPayment(invoiceId: number, input: unknown, recordedById: number) {
  const payload = parsePayment(input);
  await ensureInvoicingSchema();
  const created = await db.transaction(async (tx) => {
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId)).for("update");
    if (!invoice) throw new InvoicingError("Invoice not found.", 404);
    if (invoice.kind !== "Invoice") throw new InvoicingError("Payments are recorded against invoices, not quotations.", 400);
    if (invoice.status !== "Open") throw new InvoicingError("This invoice is cancelled; record nothing against it.", 409);
    const paidCents = await paidCentsFor(tx, invoiceId);
    const outstandingCents = invoice.totalCents - paidCents;
    if (payload.amountCents > outstandingCents) {
      throw new InvoicingError(
        `Payment is larger than the ${moneyFromCents(outstandingCents)} still outstanding on ${invoice.number}.`,
        409,
      );
    }
    const [payment] = await tx.insert(invoicePayments).values({
      invoiceId,
      amountCents: payload.amountCents,
      paidAt: payload.paidAt,
      method: payload.method,
      reference: payload.reference,
      notes: payload.notes,
      recordedById,
    }).returning({ id: invoicePayments.id });
    return {
      id: payment.id,
      invoiceId,
      customerId: invoice.customerId,
      paidCents: paidCents + payload.amountCents,
      outstandingCents: outstandingCents - payload.amountCents,
    };
  });
  await syncCustomerBalance(created.customerId);
  return created;
}

export async function deletePayment(paymentId: number, deletedById: number) {
  void deletedById;
  await ensureInvoicingSchema();
  const result = await db.transaction(async (tx) => {
    const [payment] = await tx.select().from(invoicePayments).where(eq(invoicePayments.id, paymentId));
    if (!payment) throw new InvoicingError("Payment not found.", 404);
    // Lock the invoice first (same order as recordPayment) to avoid deadlocks.
    const [invoice] = await tx.select().from(invoices).where(eq(invoices.id, payment.invoiceId)).for("update");
    if (!invoice) throw new InvoicingError("Invoice not found.", 404);
    const [removed] = await tx.delete(invoicePayments)
      .where(eq(invoicePayments.id, paymentId)).returning({ id: invoicePayments.id });
    if (!removed) throw new InvoicingError("Payment not found.", 404);
    return { id: paymentId, invoiceId: invoice.id, customerId: invoice.customerId };
  });
  await syncCustomerBalance(result.customerId);
  return result;
}

export async function cancelDocument(id: number) {
  await ensureInvoicingSchema();
  const result = await db.transaction(async (tx) => {
    const [doc] = await tx.select().from(invoices).where(eq(invoices.id, id)).for("update");
    if (!doc) throw new InvoicingError("Document not found.", 404);
    if (doc.status !== "Open") throw new InvoicingError("This document is already cancelled or converted.", 409);
    if (doc.kind === "Invoice") {
      const paidCents = await paidCentsFor(tx, id);
      if (paidCents > 0) {
        throw new InvoicingError("An invoice with recorded payments cannot be cancelled. Delete the payments first.", 409);
      }
    }
    await tx.update(invoices).set({ status: "Cancelled" }).where(eq(invoices.id, id));
    return { id, status: "Cancelled" as const, kind: doc.kind, customerId: doc.customerId };
  });
  if (result.kind === "Invoice") await syncCustomerBalance(result.customerId);
  return { id: result.id, status: result.status };
}

/** Detail view helper: one document with its lines and payments. */
export async function documentDetail(id: number) {
  await ensureInvoicingSchema();
  const [doc] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!doc) throw new InvoicingError("Document not found.", 404);
  const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id));
  const payments = await db.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, id));
  const paidCents = payments.reduce((sum, payment) => sum + payment.amountCents, 0);
  return { ...doc, lines, payments, paidCents, outstandingCents: Math.max(0, doc.totalCents - paidCents) };
}
