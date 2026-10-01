// Supplier bills and Accounts Payable rules shared by the API, UI and render-test.
// This module is intentionally server-free; bills are amounts recorded from a
// supplier's own invoice (including its tax), not WoodTek-generated documents.
import { PurchasingError, positiveId, priceCents } from "@/lib/purchasing";

export const SUPPLIER_PAYMENT_METHODS = ["Cash", "Transfer", "Check", "Other"] as const;
export type SupplierPaymentMethod = (typeof SUPPLIER_PAYMENT_METHODS)[number];
export const PAYABLE_AGING_BUCKETS = ["current", "d1-30", "d31-60", "d61-90", "d90+"] as const;
export type PayableAgingBucket = (typeof PAYABLE_AGING_BUCKETS)[number];

export const PAYABLE_AGING_LABELS: Record<PayableAgingBucket, string> = {
  current: "Current",
  "d1-30": "1–30 days",
  "d31-60": "31–60 days",
  "d61-90": "61–90 days",
  "d90+": "Over 90 days",
};

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new PurchasingError("Enter the required supplier bill details and try again.");
  }
  return input as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number, required = false): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new PurchasingError(`${label} is required.`);
  if (result.length > max) throw new PurchasingError(`${label} must be ${max} characters or fewer.`);
  return result;
}

function dateOnly(value: unknown, label: string, required: boolean): string | null {
  if (value == null || value === "") {
    if (required) throw new PurchasingError(`${label} is required.`);
    return null;
  }
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new PurchasingError(`${label} must be a valid YYYY-MM-DD date.`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new PurchasingError(`${label} is not a real calendar date.`);
  }
  return value;
}

export interface SupplierBillInput {
  supplierId: number;
  purchaseOrderId: number | null;
  reference: string;
  issueDate: string;
  dueDate: string | null;
  totalCents: number;
  notes: string;
}

export function parseSupplierBill(input: unknown): SupplierBillInput {
  const raw = record(input);
  const issueDate = dateOnly(raw.issueDate, "Bill date", true) as string;
  const dueDate = dateOnly(raw.dueDate, "Due date", false);
  if (dueDate && dueDate < issueDate) throw new PurchasingError("Due date cannot be before the bill date.");
  const totalCents = priceCents(raw.amount ?? "", "Supplier bill amount");
  if (totalCents < 1) throw new PurchasingError("Supplier bill amount must be greater than zero.");
  return {
    supplierId: positiveId(raw.supplierId, "Supplier id"),
    purchaseOrderId: raw.purchaseOrderId == null || raw.purchaseOrderId === ""
      ? null
      : positiveId(raw.purchaseOrderId, "Purchase order id"),
    reference: text(raw.reference, "Supplier invoice reference", 120, true),
    issueDate,
    dueDate,
    totalCents,
    notes: text(raw.notes, "Bill notes", 1000),
  };
}

export interface SupplierBillPaymentInput {
  requestKey: string;
  amountCents: number;
  paidAt: string;
  method: SupplierPaymentMethod;
  reference: string;
  notes: string;
}

export function parseSupplierBillPayment(input: unknown): SupplierBillPaymentInput {
  const raw = record(input);
  const requestKey = text(raw.requestKey, "Payment request key", 64, true);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)) {
    throw new PurchasingError("Payment request key must be a UUID. Refresh the form and try again.");
  }
  const amountCents = priceCents(raw.amount ?? "", "Payment amount");
  if (amountCents < 1) throw new PurchasingError("Payment amount must be greater than zero.");
  const method = text(raw.method, "Payment method", 20) || "Transfer";
  if (!(SUPPLIER_PAYMENT_METHODS as readonly string[]).includes(method)) {
    throw new PurchasingError("Payment method must be Cash, Transfer, Check or Other.");
  }
  return {
    requestKey: requestKey.toLowerCase(),
    amountCents,
    paidAt: dateOnly(raw.paidAt, "Payment date", true) as string,
    method: method as SupplierPaymentMethod,
    reference: text(raw.reference, "Payment reference", 80),
    notes: text(raw.notes, "Payment notes", 300),
  };
}

export function parseSupplierBillVoid(input: unknown): { reason: string } {
  const raw = record(input);
  return { reason: text(raw.reason, "Void reason", 300, true) };
}

export function parseSupplierBillCancellation(input: unknown): { reason: string } {
  const raw = record(input);
  return { reason: text(raw.reason, "Cancellation reason", 300, true) };
}

export function supplierBillNumber(id: number): string {
  return `SB-${String(id).padStart(6, "0")}`;
}

export function paymentState(totalCents: number, paidCents: number): "Unpaid" | "Partially paid" | "Paid" {
  if (paidCents >= totalCents && totalCents > 0) return "Paid";
  if (paidCents > 0) return "Partially paid";
  return "Unpaid";
}

export function daysPastDue(dueDate: string | null, todayIso: string): number {
  if (!dueDate) return -1;
  const due = new Date(`${dueDate}T00:00:00Z`).getTime();
  const today = new Date(`${todayIso}T00:00:00Z`).getTime();
  return Math.floor((today - due) / 86_400_000);
}

export function payableAgingBucket(dueDate: string | null, todayIso: string): PayableAgingBucket {
  const days = daysPastDue(dueDate, todayIso);
  if (days <= 0) return "current";
  if (days <= 30) return "d1-30";
  if (days <= 60) return "d31-60";
  if (days <= 90) return "d61-90";
  return "d90+";
}

export function emptyPayableAging(): Record<PayableAgingBucket, number> {
  return { current: 0, "d1-30": 0, "d31-60": 0, "d61-90": 0, "d90+": 0 };
}

export function todayIso(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
