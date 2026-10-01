// Supplier bills and Accounts Payable persistence (server only).
// Bills and payments are recorded as immutable financial snapshots. Payment
// posting, voiding and bill cancellation serialize on the bill row so concurrent
// requests cannot overpay, pay a cancelled bill, or cancel a newly-paid bill.
import { db } from "@/db";
import { purchaseOrders, suppliers, supplierBills, supplierBillPayments } from "@/db/schema";
import { asc, desc, eq, sql } from "drizzle-orm";
import {
  emptyPayableAging, daysPastDue, parseSupplierBill, parseSupplierBillCancellation,
  parseSupplierBillPayment, parseSupplierBillVoid, payableAgingBucket,
  paymentState, supplierBillNumber, todayIso,
} from "@/lib/payables";
import type { SupplierBillPaymentInput } from "@/lib/payables";
import { PurchasingError } from "@/lib/purchasing";
import { ensurePayablesSchema } from "@/lib/payablesSchema.server";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

function isUniqueViolation(error: unknown): boolean {
  const pg = error as { code?: string; cause?: { code?: string } };
  return pg?.code === "23505" || pg?.cause?.code === "23505";
}

function paymentMatches(existing: typeof supplierBillPayments.$inferSelect, billId: number, input: SupplierBillPaymentInput): boolean {
  return existing.billId === billId
    && existing.amountCents === input.amountCents
    && existing.paidAt === input.paidAt
    && existing.method === input.method
    && existing.reference === input.reference
    && existing.notes === input.notes;
}

async function postedTotal(tx: Tx, billId: number): Promise<number> {
  // Voided payments stay visible in the history but no longer reduce A/P.
  const rows = await tx.select({ amountCents: supplierBillPayments.amountCents, status: supplierBillPayments.status })
    .from(supplierBillPayments)
    .where(eq(supplierBillPayments.billId, billId));
  return rows.reduce((sum, payment) => sum + (payment.status === "Posted" ? payment.amountCents : 0), 0);
}

async function paymentTotalsFor(billId: number): Promise<{ paidCents: number; outstandingCents: number }> {
  const [bill] = await db.select({ totalCents: supplierBills.totalCents, status: supplierBills.status })
    .from(supplierBills).where(eq(supplierBills.id, billId));
  if (!bill) throw new PurchasingError("Supplier bill not found.", 404);
  const rows = await db.select({ amountCents: supplierBillPayments.amountCents, status: supplierBillPayments.status })
    .from(supplierBillPayments).where(eq(supplierBillPayments.billId, billId));
  const paidCents = rows.reduce((sum, payment) => sum + (payment.status === "Posted" ? payment.amountCents : 0), 0);
  return { paidCents, outstandingCents: bill.status === "Open" ? Math.max(0, bill.totalCents - paidCents) : 0 };
}

export async function supplierPayablesBoard() {
  await ensurePayablesSchema();
  // One repeatable-read snapshot ensures every displayed balance and aging
  // bucket uses the same bill/payment state. Reads are deliberately sequential
  // on a single transaction connection (pg@9 rejects parallel client queries).
  const [billRows, paymentRows, supplierRows] = await db.transaction(async (tx) => {
    const billRows = await tx.select().from(supplierBills)
      .orderBy(desc(supplierBills.issueDate), desc(supplierBills.id));
    const paymentRows = await tx.select().from(supplierBillPayments)
      .orderBy(asc(supplierBillPayments.paidAt), asc(supplierBillPayments.id));
    const supplierRows = await tx.select({ id: suppliers.id, name: suppliers.name }).from(suppliers);
    return [billRows, paymentRows, supplierRows] as const;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });

  const today = todayIso();
  const supplierById = new Map(supplierRows.map((supplier) => [supplier.id, supplier.name]));
  const paymentsByBill = new Map<number, typeof paymentRows>();
  for (const payment of paymentRows) {
    const list = paymentsByBill.get(payment.billId) ?? [];
    list.push(payment);
    paymentsByBill.set(payment.billId, list);
  }

  const agingBySupplier = new Map<number, ReturnType<typeof emptyPayableAging>>();
  let outstandingCents = 0;
  let overdueCents = 0;
  let openBillCount = 0;
  const bills = billRows.map((bill) => {
    const payments = paymentsByBill.get(bill.id) ?? [];
    const paidCents = payments.reduce((sum, payment) => sum + (payment.status === "Posted" ? payment.amountCents : 0), 0);
    const live = bill.status === "Open";
    const billOutstandingCents = live ? Math.max(0, bill.totalCents - paidCents) : 0;
    const overdueDays = billOutstandingCents > 0 ? daysPastDue(bill.dueDate, today) : null;
    if (billOutstandingCents > 0) {
      outstandingCents += billOutstandingCents;
      openBillCount++;
      const bucket = payableAgingBucket(bill.dueDate, today);
      const supplierAging = agingBySupplier.get(bill.supplierId) ?? emptyPayableAging();
      supplierAging[bucket] += billOutstandingCents;
      agingBySupplier.set(bill.supplierId, supplierAging);
      if (bucket !== "current") overdueCents += billOutstandingCents;
    }
    return {
      id: bill.id,
      number: supplierBillNumber(bill.id),
      supplierId: bill.supplierId,
      supplierName: supplierById.get(bill.supplierId) ?? "Supplier unavailable",
      purchaseOrderId: bill.purchaseOrderId,
      purchaseOrderNumber: bill.purchaseOrderId === null
        ? null
        : `PUR-${String(bill.purchaseOrderId).padStart(5, "0")}`,
      reference: bill.reference,
      issueDate: bill.issueDate,
      dueDate: bill.dueDate,
      totalCents: bill.totalCents,
      paidCents,
      outstandingCents: billOutstandingCents,
      paymentState: live ? paymentState(bill.totalCents, paidCents) : "Cancelled",
      overdueDays,
      notes: bill.notes,
      status: bill.status,
      cancelledAt: bill.cancelledAt,
      cancelReason: bill.cancelReason,
      createdAt: bill.createdAt,
      payments: payments.map((payment) => ({
        id: payment.id,
        amountCents: payment.amountCents,
        paidAt: payment.paidAt,
        method: payment.method,
        reference: payment.reference,
        notes: payment.notes,
        status: payment.status,
        voidedAt: payment.voidedAt,
        voidReason: payment.voidReason,
        createdAt: payment.createdAt,
      })),
    };
  });

  const aging = [...agingBySupplier.entries()].map(([supplierId, buckets]) => {
    const totalCents = Object.values(buckets).reduce((sum, value) => sum + value, 0);
    return {
      supplierId,
      supplierName: supplierById.get(supplierId) ?? "Supplier unavailable",
      buckets,
      totalCents,
      overdueCents: totalCents - buckets.current,
    };
  }).sort((a, b) => b.totalCents - a.totalCents);

  return {
    bills,
    aging,
    totals: { outstandingCents, overdueCents, openBillCount },
    today,
  };
}

export async function createSupplierBill(input: unknown, createdById: number) {
  const payload = parseSupplierBill(input);
  await ensurePayablesSchema();
  try {
    return await db.transaction(async (tx) => {
      const [supplier] = await tx.select({ id: suppliers.id })
        .from(suppliers).where(eq(suppliers.id, payload.supplierId)).for("share");
      if (!supplier) throw new PurchasingError("Supplier not found. Refresh and try again.", 409);
      if (payload.purchaseOrderId !== null) {
        const [order] = await tx.select({ id: purchaseOrders.id, supplierId: purchaseOrders.supplierId })
          .from(purchaseOrders).where(eq(purchaseOrders.id, payload.purchaseOrderId)).for("share");
        if (!order) throw new PurchasingError("Linked purchase order not found. Refresh and try again.", 409);
        if (order.supplierId !== supplier.id) {
          throw new PurchasingError("A supplier bill can only link to a purchase order from the same supplier.", 409);
        }
      }
      const [bill] = await tx.insert(supplierBills).values({
        supplierId: supplier.id,
        purchaseOrderId: payload.purchaseOrderId,
        reference: payload.reference,
        issueDate: payload.issueDate,
        dueDate: payload.dueDate,
        totalCents: payload.totalCents,
        notes: payload.notes,
        status: "Open",
        createdById,
      }).returning({ id: supplierBills.id });
      return { id: bill.id, number: supplierBillNumber(bill.id), reference: payload.reference };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new PurchasingError("That supplier invoice reference is already recorded. Check the bill history before trying again.", 409);
    }
    throw error;
  }
}

export async function recordSupplierBillPayment(billId: number, input: unknown, recordedById: number) {
  const payload = parseSupplierBillPayment(input);
  await ensurePayablesSchema();
  try {
    return await db.transaction(async (tx) => {
      // Every payment, void and cancellation locks this same bill row first.
      const [bill] = await tx.select().from(supplierBills)
        .where(eq(supplierBills.id, billId)).for("update");
      if (!bill) throw new PurchasingError("Supplier bill not found.", 404);
      const [existing] = await tx.select().from(supplierBillPayments)
        .where(eq(supplierBillPayments.requestKey, payload.requestKey));
      if (existing) {
        if (!paymentMatches(existing, billId, payload)) {
          throw new PurchasingError("This payment retry key was already used for a different payment.", 409);
        }
        const paidCents = await postedTotal(tx, billId);
        return {
          id: existing.id, billId,
          paidCents,
          outstandingCents: bill.status === "Open" ? Math.max(0, bill.totalCents - paidCents) : 0,
          replayed: true,
        };
      }
      if (bill.status !== "Open") throw new PurchasingError("This supplier bill is cancelled; payments are blocked.", 409);
      const paidCents = await postedTotal(tx, billId);
      const outstandingCents = bill.totalCents - paidCents;
      if (payload.amountCents > outstandingCents) {
        throw new PurchasingError(
          `Payment is larger than the $${(outstandingCents / 100).toFixed(2)} still outstanding on ${supplierBillNumber(billId)}.`,
          409,
        );
      }
      const [payment] = await tx.insert(supplierBillPayments).values({
        billId,
        requestKey: payload.requestKey,
        amountCents: payload.amountCents,
        paidAt: payload.paidAt,
        method: payload.method,
        reference: payload.reference,
        notes: payload.notes,
        status: "Posted",
        recordedById,
      }).returning({ id: supplierBillPayments.id });
      return {
        id: payment.id,
        billId,
        paidCents: paidCents + payload.amountCents,
        outstandingCents: outstandingCents - payload.amountCents,
        replayed: false,
      };
    });
  } catch (error) {
    // Concurrent duplicate submissions may collide on the unique retry key;
    // only return a replay after the winning transaction has committed.
    if (isUniqueViolation(error)) {
      const [existing] = await db.select().from(supplierBillPayments)
        .where(eq(supplierBillPayments.requestKey, payload.requestKey));
      if (existing) {
        if (!paymentMatches(existing, billId, payload)) {
          throw new PurchasingError("This payment retry key was already used for a different payment.", 409);
        }
        const totals = await paymentTotalsFor(billId);
        return { id: existing.id, billId, ...totals, replayed: true };
      }
    }
    throw error;
  }
}

export async function voidSupplierBillPayment(paymentId: number, input: unknown, voidedById: number) {
  const { reason } = parseSupplierBillVoid(input);
  await ensurePayablesSchema();
  return db.transaction(async (tx) => {
    const [initial] = await tx.select({ billId: supplierBillPayments.billId })
      .from(supplierBillPayments).where(eq(supplierBillPayments.id, paymentId));
    if (!initial) throw new PurchasingError("Supplier payment not found.", 404);
    const [bill] = await tx.select().from(supplierBills)
      .where(eq(supplierBills.id, initial.billId)).for("update");
    if (!bill) throw new PurchasingError("Supplier bill not found.", 404);
    const [payment] = await tx.select().from(supplierBillPayments)
      .where(eq(supplierBillPayments.id, paymentId)).for("update");
    if (!payment || payment.billId !== bill.id) throw new PurchasingError("Supplier payment not found.", 404);
    if (payment.status === "Voided") {
      if (payment.voidReason === reason) return { id: paymentId, billId: bill.id, replayed: true };
      throw new PurchasingError("This supplier payment has already been voided for a different reason.", 409);
    }
    await tx.update(supplierBillPayments).set({
      status: "Voided", voidedAt: new Date(), voidedById, voidReason: reason,
    }).where(eq(supplierBillPayments.id, paymentId));
    return { id: paymentId, billId: bill.id, replayed: false };
  });
}

export async function cancelSupplierBill(billId: number, input: unknown, cancelledById: number) {
  const { reason } = parseSupplierBillCancellation(input);
  await ensurePayablesSchema();
  return db.transaction(async (tx) => {
    const [bill] = await tx.select().from(supplierBills)
      .where(eq(supplierBills.id, billId)).for("update");
    if (!bill) throw new PurchasingError("Supplier bill not found.", 404);
    if (bill.status === "Cancelled") {
      if (bill.cancelReason === reason) return { id: billId, number: supplierBillNumber(billId), status: "Cancelled", replayed: true };
      throw new PurchasingError("This supplier bill is already cancelled.", 409);
    }
    const [posted] = await tx.select({ amountCents: sql<number>`coalesce(sum(${supplierBillPayments.amountCents}), 0)::int` })
      .from(supplierBillPayments)
      .where(sql`${supplierBillPayments.billId} = ${billId} and ${supplierBillPayments.status} = 'Posted'`);
    if (Number(posted?.amountCents ?? 0) > 0) {
      throw new PurchasingError("A bill with posted payments cannot be cancelled. Void its payments first.", 409);
    }
    await tx.update(supplierBills).set({
      status: "Cancelled", cancelledAt: new Date(), cancelledById, cancelReason: reason,
    }).where(eq(supplierBills.id, billId));
    return { id: billId, number: supplierBillNumber(billId), status: "Cancelled", replayed: false };
  });
}
