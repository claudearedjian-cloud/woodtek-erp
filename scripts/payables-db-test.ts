// Supplier bills / A/P — live PostgreSQL integration checks.
//
// Run only against a SCRATCH database:
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5432/woodtek_payables_test \
//     npx tsx scripts/payables-db-test.ts [--fresh]
//
// --fresh drops only the two new supplier-bill tables (and their dependent
// objects), then verifies the lazy first-visit DDL. Run again without the flag
// to exercise create-if-not-exists on an existing deployment.
// SAFETY: refuses database names that do not contain "test"; fixture rows are
// tagged DBTEST and are cleaned up. Never point this at factory/production DB.
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../src/db/index";
import {
  inventoryItems, purchaseOrderLines, purchaseOrders, supplierBillPayments,
  supplierBills, suppliers, users,
} from "../src/db/schema";
import { PurchasingError, newSupplierPaymentRequestKey } from "../src/lib/purchasing";
import {
  cancelSupplierBill, createSupplierBill, recordSupplierBillPayment,
  supplierPayablesBoard, voidSupplierBillPayment,
} from "../src/lib/payables.server";
import { ensurePayablesSchema } from "../src/lib/payablesSchema.server";
import { createPurchaseOrder, createSupplier } from "../src/lib/purchasing.server";
import { todayIso } from "../src/lib/payables";

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEq(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) throw new Error(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`PASS: payables-db: ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL: payables-db: ${name}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function expectFailure(
  fn: () => Promise<unknown>,
  match: { status?: number; message: RegExp },
): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const err = error as PurchasingError;
    if (match.status !== undefined) assertEq(err.status ?? null, match.status, "unexpected error status");
    assert(match.message.test(err.message), `error ${JSON.stringify(err.message)} does not match ${match.message}`);
    return;
  }
  throw new Error("expected the call to fail, but it succeeded");
}

function daysAgo(days: number): string {
  const date = new Date(`${todayIso()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const raw = process.env.DATABASE_URL ?? "";
  const dbName = raw.split("/").pop()?.split("?")[0] ?? "";
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run: database "${dbName}" does not look like a scratch database (name must contain "test").`);
  }

  const run = Date.now();
  const userIds: number[] = [];
  const supplierIds: number[] = [];
  const itemIds: number[] = [];
  const orderIds: number[] = [];
  const billIds: number[] = [];
  let payablesReady = false;

  if (process.argv.includes("--fresh")) {
    await db.execute(sql`drop table if exists supplier_bill_payments cascade`);
    await db.execute(sql`drop table if exists supplier_bills cascade`);
    console.log("note: supplier-bill tables dropped (--fresh) — lazy A/P DDL will recreate them");
  }

  try {
    await check("lazy DDL creates both A/P tables and every Drizzle-mapped column", async () => {
      await ensurePayablesSchema();
      payablesReady = true;
      const result = await db.execute(sql`
        select table_name, column_name from information_schema.columns
        where table_schema = 'public' and table_name in ('supplier_bills','supplier_bill_payments')
      `);
      const present = new Set((result.rows as Array<{ table_name: string; column_name: string }>)
        .map((row) => `${row.table_name}.${row.column_name}`));
      for (const column of [
        "supplier_bills.supplier_id", "supplier_bills.purchase_order_id", "supplier_bills.reference",
        "supplier_bills.issue_date", "supplier_bills.due_date", "supplier_bills.total_cents",
        "supplier_bills.status", "supplier_bills.cancel_reason", "supplier_bills.cancelled_by_id",
        "supplier_bill_payments.bill_id", "supplier_bill_payments.request_key", "supplier_bill_payments.amount_cents",
        "supplier_bill_payments.paid_at", "supplier_bill_payments.method", "supplier_bill_payments.status",
        "supplier_bill_payments.voided_at", "supplier_bill_payments.void_reason",
      ]) assert(present.has(column), `missing column ${column}`);
      await db.select().from(supplierBills).limit(1);
      await db.select().from(supplierBillPayments).limit(1);
      const constraints = await db.execute(sql`
        select conname from pg_constraint
        where contype = 'c' and conrelid in ('supplier_bills'::regclass, 'supplier_bill_payments'::regclass)
      `);
      assert((constraints.rows as Array<{ conname: string }>).length >= 4, "bill/payment CHECK constraints were not created");
    });

    await check("lazy schema is safe to call again (restart path)", async () => {
      await ensurePayablesSchema();
    });

    const userRows = await db.insert(users).values({
      name: `DBTEST AP clerk ${run}`, email: `dbtest-ap-${run}@example.test`, role: "Manager",
    }).returning({ id: users.id });
    const userId = userRows[0].id;
    userIds.push(userId);

    const itemRows = await db.insert(inventoryItems).values({
      sku: `DBTEST-AP-${run}`, name: `DBTEST AP item ${run}`, category: "Hardware & Fittings",
      stockQuantity: 5, unit: "pcs", unitCost: "2.50", reorderLevel: 1,
    }).returning({ id: inventoryItems.id });
    const itemId = itemRows[0].id;
    itemIds.push(itemId);

    const supplierA = await createSupplier({ name: `DBTEST AP supplier A ${run}` });
    const supplierB = await createSupplier({ name: `DBTEST AP supplier B ${run}` });
    supplierIds.push(supplierA.id, supplierB.id);
    const orderA = await createPurchaseOrder({
      supplierId: supplierA.id, expectedAt: null, notes: "DBTEST A/P link",
      lines: [{ itemId, quantity: 2, unitPrice: "2.50" }],
    }, userId, true);
    const orderB = await createPurchaseOrder({
      supplierId: supplierB.id, expectedAt: null, notes: "DBTEST other supplier",
      lines: [{ itemId, quantity: 1, unitPrice: "2.50" }],
    }, userId, true);
    orderIds.push(orderA.id, orderB.id);

    const oldDue = daysAgo(45);
    const oldIssue = daysAgo(50);
    const reference = `DBTEST-AP-INV-${run}`;
    const billInput = (overrides: Record<string, unknown> = {}) => ({
      supplierId: supplierA.id, purchaseOrderId: orderA.id, reference,
      issueDate: oldIssue, dueDate: oldDue, amount: "150.00", notes: "DBTEST A/P bill",
      ...overrides,
    });

    let billId = 0;
    await check("supplier bill snapshots its supplier reference, PO, dates and exact cents", async () => {
      const created = await createSupplierBill(billInput(), userId);
      billId = created.id;
      billIds.push(created.id);
      assertEq(created.number, `SB-${String(created.id).padStart(6, "0")}`, "stable bill reference");
      const rows = await db.select().from(supplierBills).where(eq(supplierBills.id, created.id));
      assertEq(rows[0]?.totalCents, 15_000, "$150 bill total in cents");
      assertEq(rows[0]?.purchaseOrderId, orderA.id, "linked PO snapshot");
    });

    await check("case-insensitive duplicate invoice reference is rejected only while active", async () => {
      await expectFailure(
        () => createSupplierBill(billInput({ reference: reference.toLowerCase() }), userId),
        { status: 409, message: /already recorded/i },
      );
    });

    await check("a bill cannot link to a different supplier's PO", async () => {
      await expectFailure(
        () => createSupplierBill(billInput({ reference: `${reference}-WRONG`, purchaseOrderId: orderB.id }), userId),
        { status: 409, message: /same supplier/i },
      );
    });

    const firstPaymentInput = {
      requestKey: newSupplierPaymentRequestKey(), amount: "25.00", paidAt: todayIso(),
      method: "Transfer", reference: `DBTEST-TRANSFER-${run}`, notes: "First instalment",
    };
    let firstPaymentId = 0;
    await check("partial payment posts once; same UUID retry returns the original payment", async () => {
      const first = await recordSupplierBillPayment(billId, firstPaymentInput, userId);
      firstPaymentId = first.id;
      assertEq(first.paidCents, 2_500, "partial paid amount");
      assertEq(first.outstandingCents, 12_500, "remaining amount");
      const replay = await recordSupplierBillPayment(billId, firstPaymentInput, userId);
      assertEq(replay.id, first.id, "retry returns original payment id");
      assertEq(replay.replayed, true, "retry is marked replayed");
    });

    await check("A/P board and aging agree with payment history to the cent", async () => {
      const board = await supplierPayablesBoard();
      const bill = board.bills.find((row) => row.id === billId);
      const aging = board.aging.find((row) => row.supplierId === supplierA.id);
      assert(bill, "bill missing from board");
      assertEq(bill.paidCents, 2_500, "paid amount");
      assertEq(bill.outstandingCents, 12_500, "outstanding amount");
      assertEq(bill.payments.length, 1, "retry did not add a second row");
      assertEq(aging?.buckets["d31-60"], 12_500, "45-days-past-due aging bucket");
      assertEq(aging?.overdueCents, 12_500, "supplier overdue roll-up");
    });

    await check("bill with a posted payment cannot be cancelled; void keeps the payment and releases its balance", async () => {
      await expectFailure(
        () => cancelSupplierBill(billId, { reason: "DBTEST attempted cancel" }, userId),
        { status: 409, message: /posted payments/i },
      );
      await voidSupplierBillPayment(firstPaymentId, { reason: "DBTEST bank correction" }, userId);
      const board = await supplierPayablesBoard();
      const bill = board.bills.find((row) => row.id === billId)!;
      assertEq(bill.payments[0]?.status, "Voided", "void is preserved in payment history");
      assertEq(bill.paidCents, 0, "voided amount no longer counts as paid");
      assertEq(bill.outstandingCents, 15_000, "void reopens the full payable");
    });

    await check("cancellation is reasoned and a corrected bill may reuse its cancelled reference", async () => {
      await cancelSupplierBill(billId, { reason: "DBTEST incorrect amount" }, userId);
      const corrected = await createSupplierBill(billInput({ amount: "145.00", notes: "Corrected DBTEST bill" }), userId);
      billIds.push(corrected.id);
      const board = await supplierPayablesBoard();
      const cancelled = board.bills.find((row) => row.id === billId)!;
      assertEq(cancelled.status, "Cancelled", "original remains in history");
      assertEq(cancelled.cancelReason, "DBTEST incorrect amount", "reason is stored");
      assert(board.bills.some((row) => row.id === corrected.id && row.totalCents === 14_500), "corrected reference was re-entered");
    });

    await check("concurrent same-key submissions serialize to one payment row", async () => {
      const retryBill = await createSupplierBill(billInput({ reference: `${reference}-RETRY`, dueDate: null, amount: "50.00" }), userId);
      billIds.push(retryBill.id);
      const payment = {
        requestKey: newSupplierPaymentRequestKey(), amount: "30.00", paidAt: todayIso(),
        method: "Check", reference: `DBTEST-CHECK-${run}`, notes: "Same request submitted twice",
      };
      const [a, b] = await Promise.all([
        recordSupplierBillPayment(retryBill.id, payment, userId),
        recordSupplierBillPayment(retryBill.id, payment, userId),
      ]);
      assertEq(a.id, b.id, "concurrent retries return one payment id");
      const rows = await db.select().from(supplierBillPayments).where(eq(supplierBillPayments.billId, retryBill.id));
      assertEq(rows.length, 1, "only one payment row is stored");
      const board = await supplierPayablesBoard();
      const loaded = board.bills.find((row) => row.id === retryBill.id)!;
      assertEq(loaded.paidCents, 3_000, "one $30 payment posted");
      assertEq(loaded.outstandingCents, 2_000, "$20 remains");
    });

    await check("concurrent distinct payments cannot overpay; bill lock serializes both attempts", async () => {
      const overpayBill = await createSupplierBill(billInput({ reference: `${reference}-OVERPAY`, dueDate: null, amount: "50.00" }), userId);
      billIds.push(overpayBill.id);
      const makePayment = () => ({
        requestKey: newSupplierPaymentRequestKey(), amount: "30.00", paidAt: todayIso(),
        method: "Transfer", reference: `DBTEST-RACE-${run}`, notes: "Concurrent overpay test",
      });
      const results = await Promise.allSettled([
        recordSupplierBillPayment(overpayBill.id, makePayment(), userId),
        recordSupplierBillPayment(overpayBill.id, makePayment(), userId),
      ]);
      assertEq(results.filter((result) => result.status === "fulfilled").length, 1, "exactly one $30 attempt succeeds");
      assertEq(results.filter((result) => result.status === "rejected").length, 1, "the overpayment loses with a conflict");
      await expectFailure(
        () => cancelSupplierBill(overpayBill.id, { reason: "DBTEST blocked while paid" }, userId),
        { status: 409, message: /posted payments/i },
      );
    });

    console.log(`\n${passed} passed, ${failed} failed`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    // The live suite is tagged and scoped to these IDs. Preserve all factory rows.
    try {
      if (payablesReady && billIds.length) {
        await db.delete(supplierBillPayments).where(inArray(supplierBillPayments.billId, billIds));
        await db.delete(supplierBills).where(inArray(supplierBills.id, billIds));
      }
      if (orderIds.length) {
        await db.delete(purchaseOrderLines).where(inArray(purchaseOrderLines.orderId, orderIds));
        await db.delete(purchaseOrders).where(inArray(purchaseOrders.id, orderIds));
      }
      if (supplierIds.length) await db.delete(suppliers).where(inArray(suppliers.id, supplierIds));
      if (itemIds.length) await db.delete(inventoryItems).where(inArray(inventoryItems.id, itemIds));
      if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    } catch (error) {
      console.error("payables-db cleanup failed; remove DBTEST rows from the scratch database only", error);
      process.exitCode = 1;
    }
    await pool.end();
  }
}

main().catch(async (error) => {
  console.error(error);
  process.exitCode = 1;
  await pool.end();
});
