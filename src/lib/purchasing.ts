// Purchasing rules shared by the API, UI and render-test. No server imports.
// Money is a separate optional grant: a purchasing grant alone never reveals
// purchase prices or inventory costs, and cannot submit a nonzero PO price.

export const MAX_PURCHASE_QUANTITY = 1_000_000;
const MAX_PRICE_CENTS = 99_999_999; // $999,999.99 per unit

export class PurchasingError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "PurchasingError";
  }
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PurchasingError("Enter the required details and try again.");
  }
  return input as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number, required = false): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new PurchasingError(`${label} is required.`);
  if (result.length > max) throw new PurchasingError(`${label} must be ${max} characters or fewer.`);
  return result;
}

function wholeNumber(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
}

export function positiveId(value: unknown, label = "Id"): number {
  const result = wholeNumber(value);
  if (result === null || result <= 0) throw new PurchasingError(`${label} must be a positive integer.`);
  return result;
}

function quantity(value: unknown): number {
  const result = wholeNumber(value);
  if (result === null || result < 1 || result > MAX_PURCHASE_QUANTITY) {
    throw new PurchasingError(`Quantity must be a whole number from 1 to ${MAX_PURCHASE_QUANTITY.toLocaleString()}.`);
  }
  return result;
}

export function priceCents(value: unknown): number {
  const price = typeof value === "number" ? String(value) : value;
  if (typeof price !== "string" || !/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(price)) {
    throw new PurchasingError("Unit price must be a non-negative amount with up to 2 decimals (maximum $999,999.99).");
  }
  const [whole, fraction = ""] = price.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents > MAX_PRICE_CENTS) throw new PurchasingError("Unit price exceeds $999,999.99.");
  return cents;
}

export function moneyFromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * GRN retry keys must work on the factory's plain-HTTP LAN URL too.
 * randomUUID() requires a secure context in browsers; getRandomValues() is
 * available on insecure origins as well and still uses secure randomness.
 */
export function newReceiptRequestKey(provider: {
  randomUUID?: () => string;
  getRandomValues: (bytes: Uint8Array) => Uint8Array;
} = globalThis.crypto): string {
  if (typeof provider?.randomUUID === "function") return provider.randomUUID();
  if (typeof provider?.getRandomValues !== "function") {
    throw new PurchasingError("This browser cannot generate a secure receipt key. Try a modern browser.");
  }
  const bytes = provider.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // UUID v4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface SupplierInput {
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
}

export function parseSupplier(input: unknown): SupplierInput {
  const raw = record(input);
  const email = text(raw.email, "Email", 254).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PurchasingError("Enter a valid supplier email address.");
  return {
    name: text(raw.name, "Supplier name", 120, true),
    contactName: text(raw.contactName, "Contact name", 120),
    phone: text(raw.phone, "Phone", 60),
    email,
    address: text(raw.address, "Address", 400),
    notes: text(raw.notes, "Notes", 1000),
  };
}

export interface PurchaseOrderInput {
  supplierId: number;
  expectedAt: string | null;
  notes: string;
  lines: Array<{ itemId: number; quantity: number; unitPrice: string }>;
}

function validDate(input: unknown): string | null {
  if (input == null || input === "") return null;
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new PurchasingError("Expected delivery must be a valid YYYY-MM-DD date.");
  }
  const date = new Date(`${input}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input) {
    throw new PurchasingError("Expected delivery is not a real calendar date.");
  }
  return input;
}

export function parsePurchaseOrder(input: unknown, maySetPrice: boolean): PurchaseOrderInput {
  const raw = record(input);
  if (!Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > 50) {
    throw new PurchasingError("A purchase order must have 1 to 50 stock lines.");
  }
  const seen = new Set<number>();
  const lines = raw.lines.map((value) => {
    const line = record(value);
    const itemId = positiveId(line.itemId, "Stock item id");
    if (seen.has(itemId)) throw new PurchasingError("Add each stock item only once per purchase order.");
    seen.add(itemId);
    const cents = priceCents(line.unitPrice ?? "0.00");
    if (!maySetPrice && cents !== 0) {
      throw new PurchasingError("An Invoicing & Money grant is required to set purchase prices.", 403);
    }
    return { itemId, quantity: quantity(line.quantity), unitPrice: moneyFromCents(cents) };
  });
  return {
    supplierId: positiveId(raw.supplierId, "Supplier id"),
    expectedAt: validDate(raw.expectedAt),
    notes: text(raw.notes, "Order notes", 1000),
    lines,
  };
}

export interface ReceiptInput {
  requestKey: string;
  deliveryRef: string;
  notes: string;
  lines: Array<{ poLineId: number; quantity: number }>;
}

export function parseGoodsReceipt(input: unknown): ReceiptInput {
  const raw = record(input);
  const requestKey = text(raw.requestKey, "Receipt request key", 64, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)) {
    throw new PurchasingError("Receipt request key must be a UUID. Refresh the form and try again.");
  }
  if (!Array.isArray(raw.lines) || raw.lines.length < 1 || raw.lines.length > 50) {
    throw new PurchasingError("A goods receipt must have 1 to 50 received lines.");
  }
  const seen = new Set<number>();
  const lines = raw.lines.map((value) => {
    const line = record(value);
    const poLineId = positiveId(line.poLineId, "Purchase order line id");
    if (seen.has(poLineId)) throw new PurchasingError("A goods receipt cannot repeat a purchase order line.");
    seen.add(poLineId);
    return { poLineId, quantity: quantity(line.quantity) };
  });
  return {
    requestKey: requestKey.toLowerCase(),
    deliveryRef: text(raw.deliveryRef, "Supplier delivery reference", 120),
    notes: text(raw.notes, "Receipt notes", 1000),
    lines,
  };
}

export interface PurchaseLineSnapshot {
  id: number;
  itemId: number | null;
  itemSku: string;
  itemName: string;
  itemUnit: string;
  quantity: number;
  unitPrice: string;
}

export interface ReceivedLine {
  poLineId: number;
  quantity: number;
}

/** Receipt history is the source of truth; an outstanding quantity is never edited directly. */
export function summarizeOrderLines(
  lines: readonly PurchaseLineSnapshot[],
  receipts: readonly ReceivedLine[],
  status: string,
  maySeeMoney: boolean,
) {
  const received = new Map<number, number>();
  for (const line of receipts) received.set(line.poLineId, (received.get(line.poLineId) ?? 0) + line.quantity);
  let orderedQty = 0;
  let receivedQty = 0;
  let awaitingQty = 0;
  let totalCents = 0;
  let awaitingCents = 0;
  const summarized = lines.map((line) => {
    const receivedQuantity = Math.min(line.quantity, Math.max(0, received.get(line.id) ?? 0));
    const remaining = line.quantity - receivedQuantity;
    const cents = priceCents(line.unitPrice);
    orderedQty += line.quantity;
    receivedQty += receivedQuantity;
    if (status === "Open") {
      awaitingQty += remaining;
      awaitingCents += remaining * cents;
    }
    totalCents += line.quantity * cents;
    return {
      ...line,
      receivedQuantity,
      remainingQuantity: remaining,
      unitPrice: maySeeMoney ? line.unitPrice : null,
      lineTotal: maySeeMoney ? moneyFromCents(line.quantity * cents) : null,
    };
  });
  return {
    lines: summarized,
    orderedQty,
    receivedQty,
    awaitingQty,
    total: maySeeMoney ? moneyFromCents(totalCents) : null,
    awaitingValue: maySeeMoney ? moneyFromCents(awaitingCents) : null,
  };
}

/** Restock to twice the reorder point, subtracting already-open PO quantities. */
export function suggestedReorderQty(stock: number, reorderLevel: number, alreadyOnOrder = 0): number {
  const safeStock = Math.max(0, Math.trunc(Number(stock) || 0));
  const threshold = Math.max(0, Math.trunc(Number(reorderLevel) || 0));
  const ordered = Math.max(0, Math.trunc(Number(alreadyOnOrder) || 0));
  const target = threshold > 0 ? threshold * 2 : 1;
  return Math.min(MAX_PURCHASE_QUANTITY, Math.max(0, target - safeStock - ordered));
}

export const purchaseNumber = (id: number) => `PUR-${String(id).padStart(5, "0")}`;
export const goodsReceiptNumber = (id: number) => `GRN-${String(id).padStart(5, "0")}`;
