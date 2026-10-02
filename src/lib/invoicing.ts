// Invoicing & Accounts Receivable — rules shared by the API, UI and render-test.
// No server imports. This is the money loop's final stage: quotations and VAT
// invoices (11% Lebanon by default) with legal per-year numbering, payments
// against invoices and A/R aging. Everything here is money — the whole module
// lives behind the Invoicing & Money grant (`authorizeModule("invoicing")`).
// Amounts cross boundaries as integer cents; the UI formats them.

export const LEBANON_VAT_RATE = "11.00"; // percent — snapshotted per document
export const MAX_DOC_LINES = 50;
export const MAX_LINE_DESCRIPTION = 200;
export const MAX_LINE_QUANTITY_HUNDREDTHS = 99_999_999; // 999,999.99
export const MAX_PRICE_CENTS = 99_999_999; // $999,999.99 per unit
export const MAX_STOCK_PICKER_RESULTS = 50;
export const PAYMENT_METHODS = ["Cash", "Transfer", "Check", "Other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export class InvoicingError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "InvoicingError";
  }
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InvoicingError("Enter the required details and try again.");
  }
  return input as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number, required = false): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new InvoicingError(`${label} is required.`);
  if (result.length > max) throw new InvoicingError(`${label} must be ${max} characters or fewer.`);
  return result;
}

function wholeNumber(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
}

export function positiveId(value: unknown, label = "Id"): number {
  const result = wholeNumber(value);
  if (result === null || result <= 0) throw new InvoicingError(`${label} must be a positive integer.`);
  return result;
}

function dateOnly(value: unknown, label: string, required: boolean): string | null {
  if (value == null || value === "") {
    if (required) throw new InvoicingError(`${label} is required.`);
    return null;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InvoicingError(`${label} must be a valid YYYY-MM-DD date.`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new InvoicingError(`${label} is not a real calendar date.`);
  }
  return value;
}

export function priceCents(value: unknown, label = "Unit price"): number {
  const price = typeof value === "number" ? String(value) : value;
  if (typeof price !== "string" || !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(price)) {
    throw new InvoicingError(`${label} must be a non-negative amount with up to 2 decimals (maximum $999,999.99).`);
  }
  const [whole, fraction = ""] = price.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents > MAX_PRICE_CENTS) throw new InvoicingError(`${label} exceeds $999,999.99.`);
  return cents;
}

export function moneyFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** "3.50" -> 350 hundredths; whole numbers and up to 2 decimals. */
export function quantityHundredths(value: unknown): number {
  const qty = typeof value === "number" ? String(value) : value;
  if (typeof qty !== "string" || !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(qty)) {
    throw new InvoicingError("Quantity must be a number with up to 2 decimals (maximum 999,999.99).");
  }
  const [whole, fraction = ""] = qty.split(".");
  const hundredths = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (hundredths < 1 || hundredths > MAX_LINE_QUANTITY_HUNDREDTHS) {
    throw new InvoicingError("Quantity must be greater than zero.");
  }
  return hundredths;
}

/** "11.00" -> 1100 basis points (hundredths of a percent). */
export function vatRateBps(value: unknown): number {
  const rate = typeof value === "number" ? String(value) : value;
  const input = typeof rate === "string" && rate.trim() !== "" ? rate.trim() : LEBANON_VAT_RATE;
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(input)) {
    throw new InvoicingError("VAT rate must be a percentage from 0 to 100 with up to 2 decimals.");
  }
  const [whole, fraction = ""] = input.split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (bps > 10_000) throw new InvoicingError("VAT rate must be between 0 and 100.");
  return bps;
}

export function vatRateFromBps(bps: number): string {
  return (bps / 100).toFixed(2);
}

// ------------------------------------------------------- line stock picker
// The description field of a draft line doubles as a searchable stock picker.
// The picker may only ever see stock IDENTITY — never costs, never quantities
// (see `stockIdentity`). Picking an item stores the link plus a stable
// name/SKU description snapshot, so a later rename cannot rewrite a legal
// document; plain text stays available for services and fees.

export interface StockIdentity {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
}

/** The only stock fields a document line may see or store. */
export const STOCK_IDENTITY_KEYS = ["id", "sku", "name", "category", "unit"] as const;

/** Strips a stock row down to its identity: no unitCost, no stockQuantity. */
export function stockIdentity(row: {
  id: number; sku: string; name: string; category: string; unit: string;
}): StockIdentity {
  return { id: row.id, sku: row.sku, name: row.name, category: row.category, unit: row.unit };
}

/** Stable line description snapshot for a picked item: "Name (SKU)". */
export function stockLineDescription(item: { name: string; sku: string }): string {
  const name = String(item.name ?? "").trim();
  const sku = String(item.sku ?? "").trim();
  const snapshot = name && sku ? `${name} (${sku})` : name || sku;
  return snapshot.length > MAX_LINE_DESCRIPTION
    ? `${snapshot.slice(0, MAX_LINE_DESCRIPTION - 3)}...`
    : snapshot;
}

/** Picker filter: name, SKU, category or unit, case-insensitive; "" shows all. */
export function filterStockItems<T extends StockIdentity>(
  items: readonly T[],
  query: string,
  limit = MAX_STOCK_PICKER_RESULTS,
): T[] {
  const needle = String(query ?? "").trim().toLowerCase();
  const matches = needle
    ? items.filter((item) =>
        [item.name, item.sku, item.category, item.unit]
          .some((value) => String(value ?? "").toLowerCase().includes(needle)))
    : [...items];
  return matches.slice(0, Math.max(0, limit));
}

/**
 * Clicking a field that still holds its item's snapshot browses the whole
 * stock list; any other text (a search or a service description) filters it.
 */
export function stockPickerQuery(
  description: string,
  linked: Pick<StockIdentity, "name" | "sku"> | null | undefined,
): string {
  const text = String(description ?? "");
  if (linked && text.trim() === stockLineDescription(linked)) return "";
  return text;
}

/** Optional inventory link: absent/blank -> null; anything else must be a positive id. */
export function optionalInventoryItemId(value: unknown): number | null {
  if (value == null || value === "") return null;
  return positiveId(value, "Stock item id");
}

export type DocumentKind = "Quote" | "Invoice";

export interface DocumentLine {
  /** Stock item this line was picked from, or null for a custom service/fee line. */
  inventoryItemId: number | null;
  description: string;
  quantityHundredths: number;
  unitPriceCents: number;
  lineTotalCents: number;
}

export interface DocumentInput {
  customerId: number;
  issueDate: string;
  dueDate: string | null;
  vatRateBps: number;
  notes: string;
  lines: DocumentLine[];
  subtotalCents: number;
  vatCents: number;
  totalCents: number;
}

export function parseDocument(kind: DocumentKind, input: unknown): DocumentInput {
  if (kind !== "Quote" && kind !== "Invoice") throw new InvoicingError("Choose Quote or Invoice.");
  const raw = record(input);
  const rawLines = Array.isArray(raw.lines) ? raw.lines : null;
  if (!rawLines || rawLines.length < 1 || rawLines.length > MAX_DOC_LINES) {
    throw new InvoicingError(`A ${kind.toLowerCase()} must have 1 to ${MAX_DOC_LINES} lines.`);
  }
  const lines = rawLines.map((value) => {
    const line = record(value);
    const quantityHundredthsValue = quantityHundredths(line.quantity);
    const unitPriceCents = priceCents(line.unitPrice ?? "0.00");
    const inventoryItemId = optionalInventoryItemId(line.inventoryItemId);
    const description = text(line.description, "Line description", MAX_LINE_DESCRIPTION);
    // A picked stock item supplies the snapshot server-side, so its text may
    // be left empty here; a custom service/fee line must carry its own text.
    if (!description && inventoryItemId === null) {
      throw new InvoicingError("Line description is required.");
    }
    return {
      inventoryItemId,
      description,
      quantityHundredths: quantityHundredthsValue,
      unitPriceCents,
      lineTotalCents: Math.round((quantityHundredthsValue * unitPriceCents) / 100),
    };
  });
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const rateBps = vatRateBps(raw.vatRate);
  const vatCents = Math.round((subtotalCents * rateBps) / 10_000);
  return {
    customerId: positiveId(raw.customerId, "Customer id"),
    issueDate: dateOnly(raw.issueDate, "Issue date", true) as string,
    dueDate: dateOnly(raw.dueDate, "Due date", false),
    vatRateBps: rateBps,
    notes: text(raw.notes, "Notes", 1000),
    lines,
    subtotalCents,
    vatCents,
    totalCents: subtotalCents + vatCents,
  };
}

export interface PaymentInput {
  amountCents: number;
  paidAt: string;
  method: PaymentMethod;
  reference: string;
  notes: string;
}

export function parsePayment(input: unknown): PaymentInput {
  const raw = record(input);
  const amountCents = priceCents(raw.amount ?? "", "Payment amount");
  if (amountCents < 1) throw new InvoicingError("Payment amount must be greater than zero.");
  const methodRaw = text(raw.method, "Method", 20) || "Cash";
  if (!(PAYMENT_METHODS as readonly string[]).includes(methodRaw)) {
    throw new InvoicingError("Payment method must be Cash, Transfer, Check or Other.");
  }
  return {
    amountCents,
    paidAt: dateOnly(raw.paidAt, "Payment date", true) as string,
    method: methodRaw as PaymentMethod,
    reference: text(raw.reference, "Reference", 80),
    notes: text(raw.notes, "Notes", 300),
  };
}

// ---------------------------------------------------------------- numbering

export type DocumentSeries = "INV" | "QUO";
export const seriesFor = (kind: DocumentKind): DocumentSeries => (kind === "Quote" ? "QUO" : "INV");

/** Legal numbering: sequential per calendar year, never reused (even cancelled). */
export function documentNumber(series: DocumentSeries, year: number, n: number): string {
  return `${series}-${year}-${String(n).padStart(6, "0")}`;
}

// ------------------------------------------------------- derived money state

export type PaymentState = "Paid" | "Partially paid" | "Unpaid";

export function paymentState(totalCents: number, paidCents: number): PaymentState {
  if (paidCents >= totalCents && totalCents > 0) return "Paid";
  if (paidCents > 0) return "Partially paid";
  return "Unpaid";
}

// ----------------------------------------------------------------- A/R aging

export type AgingBucket = "current" | "d1-30" | "d31-60" | "d61-90" | "d90+";
export const AGING_BUCKETS: readonly AgingBucket[] = ["current", "d1-30", "d31-60", "d61-90", "d90+"] as const;
export const AGING_LABELS: Record<AgingBucket, string> = {
  "current": "Current",
  "d1-30": "1–30 days",
  "d31-60": "31–60 days",
  "d61-90": "61–90 days",
  "d90+": "Over 90 days",
};

/** Whole days the due date lies in the past (0 or negative = not yet due). */
export function daysPastDue(dueDate: string | null, todayIso: string): number {
  if (!dueDate) return -1;
  const due = new Date(`${dueDate}T00:00:00Z`).getTime();
  const today = new Date(`${todayIso}T00:00:00Z`).getTime();
  return Math.floor((today - due) / 86_400_000);
}

export function agingBucketFor(dueDate: string | null, todayIso: string): AgingBucket {
  const days = daysPastDue(dueDate, todayIso);
  if (days <= 0) return "current";
  if (days <= 30) return "d1-30";
  if (days <= 60) return "d31-60";
  if (days <= 90) return "d61-90";
  return "d90+";
}

export function emptyAging(): Record<AgingBucket, number> {
  return { "current": 0, "d1-30": 0, "d31-60": 0, "d61-90": 0, "d90+": 0 };
}

/** Today's date on the server's clock, as YYYY-MM-DD (documents date by issue date). */
export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Optional date field with the same validation as required dates. */
export function optionalDateOnly(value: unknown, label: string): string | null {
  return dateOnly(value, label, false);
}

export function addDaysIso(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}
