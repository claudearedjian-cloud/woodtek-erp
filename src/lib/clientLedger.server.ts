// Client ledger — data/client-ledger.json overlay + the Invoicing & A/R bridge.
// Server only. Manual adjustments (opening balances, goodwill credits) live in
// the JSON overlay exactly as before; structured documents live in PostgreSQL
// (invoices + payments). Reads MERGE both sources so the client statement and
// the credit checks see one account history. customers.currentBalance is
// re-synced after every change on either side. Document-derived entries are
// marked source:"document" and must never be edited by hand — void the
// document in Invoicing & A/R instead.
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "@/lib/atomicFile.server";
import { db } from "@/db";
import { customers, invoicePayments, invoices } from "@/db/schema";
import { asc, eq, inArray } from "drizzle-orm";

export interface LedgerEntry {
  id: number | string;
  type: "invoice" | "payment";
  amount: number;
  reference: string | null;
  notes: string | null;
  at: string;
  /** "document" = generated from Invoicing & A/R; hand-edits are "manual". */
  source?: "manual" | "document";
}

export type LedgerFile = { version: 1; entries: Record<string, LedgerEntry[]> };

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "client-ledger.json");
}

export function readLedgerFile(): LedgerFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    if (parsed?.entries && typeof parsed.entries === "object") return { version: 1, entries: parsed.entries };
  } catch {
    /* first run */
  }
  return { version: 1, entries: {} };
}

export function writeLedgerFile(data: LedgerFile) {
  writeJsonAtomic(fileLocation(), data);
}

export function summarize(entries: LedgerEntry[]) {
  const invoiced = entries.filter((e) => e.type === "invoice").reduce((s, e) => s + e.amount, 0);
  const paid = entries.filter((e) => e.type === "payment").reduce((s, e) => s + e.amount, 0);
  const balance = Math.round((invoiced - paid) * 100) / 100;
  return { invoiced: Math.round(invoiced * 100) / 100, paid: Math.round(paid * 100) / 100, balance };
}

/**
 * Ledger entries generated from structured documents. Cancelled invoices are
 * excluded (their number stays reserved but they leave the account); quotes
 * never enter the ledger. Payments attach to their invoice's number.
 */
export async function documentLedgerEntries(customerId: number): Promise<LedgerEntry[]> {
  const invoiceRows = await db.select().from(invoices)
    .where(eq(invoices.customerId, customerId)).orderBy(asc(invoices.issueDate), asc(invoices.id));
  const ids = invoiceRows.map((row) => row.id);
  if (ids.length === 0) return [];
  const paymentRows = await db.select().from(invoicePayments)
    .where(inArray(invoicePayments.invoiceId, ids)).orderBy(asc(invoicePayments.paidAt), asc(invoicePayments.id));
  const numberById = new Map(invoiceRows.map((row) => [row.id, row.number]));
  const entries: LedgerEntry[] = [];
  for (const row of invoiceRows) {
    if (row.status === "Cancelled") continue;
    if (row.kind === "Invoice") {
      entries.push({
        id: `inv-${row.id}`,
        type: "invoice",
        amount: row.totalCents / 100,
        reference: row.number,
        notes: row.notes || null,
        at: `${row.issueDate}T00:00:00.000Z`,
        source: "document",
      });
    }
  }
  for (const payment of paymentRows) {
    const parent = invoiceRows.find((row) => row.id === payment.invoiceId);
    if (!parent || parent.status === "Cancelled" || parent.kind !== "Invoice") continue;
    entries.push({
      id: `pay-${payment.id}`,
      type: "payment",
      amount: payment.amountCents / 100,
      reference: payment.reference || numberById.get(payment.invoiceId) || null,
      notes: [payment.method === "Cash" ? "" : payment.method, payment.notes].filter(Boolean).join(" · ") || null,
      at: `${payment.paidAt}T00:00:00.000Z`,
      source: "document",
    });
  }
  return entries;
}

/** Manual overlay entries + document entries = the account history. */
export async function loadMergedLedger(customerId: number) {
  const manual = (readLedgerFile().entries[String(customerId)] ?? []).map((entry) => ({
    ...entry,
    source: (entry.source ?? "manual") as "manual" | "document",
  }));
  const docs = await documentLedgerEntries(customerId);
  return { entries: [...manual, ...docs], ...summarize([...manual, ...docs]) };
}

/** Re-sync the cached balance used by credit checks elsewhere. */
export async function syncCustomerBalance(customerId: number | null): Promise<void> {
  if (customerId == null) return;
  const summary = await loadMergedLedger(customerId);
  await db.update(customers).set({ currentBalance: String(summary.balance) }).where(eq(customers.id, customerId));
}
