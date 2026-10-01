// Purchasing & Suppliers — live PostgreSQL integration checks.
//
// Run (against a SCRATCH database only):
//   DATABASE_URL=postgresql://postgres@127.0.0.1:5432/woodtek_purchasing_test \
//     npx tsx scripts/purchasing-db-test.ts [--fresh]
//
// --fresh drops the five purchasing tables first, exercising the factory's
// lazy first-visit DDL (purchasingSchema.server.ts). Without it the run
// exercises the restart path: create-if-not-exists against existing tables.
// Run once with --fresh and once without to cover both.
//
// SAFETY: refuses to run unless the database name contains "test".
// The suite creates and deletes only its own DBTEST rows; nothing else is
// touched. Checks run in order and share their fixtures.
import { eq, inArray, sql } from "drizzle-orm";
import { db, pool } from "../src/db/index";
import {
  goodsReceiptLines,
  goodsReceipts,
  inventoryItems,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
  users,
} from "../src/db/schema";
import { PurchasingError, newReceiptRequestKey } from "../src/lib/purchasing";
import {
  createPurchaseOrder,
  createSupplier,
  finishPurchaseOrder,
  purchasingBoard,
  receivePurchaseOrder,
  updateSupplier,
} from "../src/lib/purchasing.server";
import { ensurePurchasingSchema } from "../src/lib/purchasingSchema.server";

let passed = 0;
let failed = 0;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEq(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`PASS: purchasing-db: ${name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL: purchasing-db: ${name}`);
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
    if (match.status !== undefined) {
      assertEq(err.status ?? null, match.status, "unexpected error status");
    }
    assert(match.message.test(err.message), `error ${JSON.stringify(err.message)} does not match ${match.message}`);
    return;
  }
  throw new Error("expected the call to fail, but it succeeded");
}

async function expectSupplierNameDuplicate(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const err = error as { status?: number; code?: string; cause?: { code?: string }; message: string };
    const uniqueViolation = err.code === "23505" || err.cause?.code === "23505";
    const mapped = err.status === 409 && /already exists/i.test(err.message);
    assert(uniqueViolation || mapped, `unexpected error shape: ${err.message}`);
    return;
  }
  throw new Error("a duplicate supplier name was accepted");
}

async function stockOf(itemId: number): Promise<number | null> {
  const rows = await db.select({ quantity: inventoryItems.stockQuantity })
    .from(inventoryItems).where(eq(inventoryItems.id, itemId));
  return rows[0]?.quantity ?? null;
}

async function receiptsOf(orderId: number) {
  return db.select().from(goodsReceipts).where(eq(goodsReceipts.orderId, orderId));
}

async function main(): Promise<void> {
  // ---- safety guard ----
  const raw = process.env.DATABASE_URL ?? "";
  const dbName = raw.split("/").pop()?.split("?")[0] ?? "";
  if (!/test/i.test(dbName)) {
    throw new Error(`Refusing to run: database "${dbName}" does not look like a scratch database (name must contain "test").`);
  }

  const run = Date.now();
  const supplierPrefix = `DBTEST SUP ${run}`;
  let itemIds: number[] = [];

  if (process.argv.includes("--fresh")) {
    await db.execute(sql`drop table if exists goods_receipt_lines cascade`);
    await db.execute(sql`drop table if exists goods_receipts cascade`);
    await db.execute(sql`drop table if exists purchase_order_lines cascade`);
    await db.execute(sql`drop table if exists purchase_orders cascade`);
    await db.execute(sql`drop table if exists suppliers cascade`);
    console.log("note: purchasing tables dropped (--fresh) — lazy first-visit DDL will recreate them");
  }

  try {
    await check("lazy DDL creates the five tables with the columns Drizzle maps (and guards the ledger)", async () => {
      await ensurePurchasingSchema();
      const result = await db.execute(sql`
        select table_name, column_name from information_schema.columns
        where table_schema = 'public'
          and table_name in ('suppliers','purchase_orders','purchase_order_lines','goods_receipts','goods_receipt_lines')
      `);
      const present = new Set(
        (result.rows as Array<{ table_name: string; column_name: string }>)
          .map((row) => `${row.table_name}.${row.column_name}`),
      );
      for (const ref of [
        "suppliers.name", "suppliers.active", "suppliers.contact_name",
        "purchase_orders.supplier_id", "purchase_orders.status", "purchase_orders.expected_at",
        "purchase_order_lines.item_sku", "purchase_order_lines.item_name", "purchase_order_lines.item_unit",
        "purchase_order_lines.quantity", "purchase_order_lines.unit_price",
        "goods_receipts.request_key", "goods_receipts.delivery_ref", "goods_receipts.received_by_id",
        "goods_receipt_lines.po_line_id", "goods_receipt_lines.quantity",
      ]) {
        assert(present.has(ref), `missing column ${ref}`);
      }
      // Drizzle can read every table: the raw DDL and schema.ts agree.
      await db.select().from(suppliers).limit(1);
      await db.select().from(purchaseOrders).limit(1);
      await db.select().from(purchaseOrderLines).limit(1);
      await db.select().from(goodsReceipts).limit(1);
      await db.select().from(goodsReceiptLines).limit(1);
      // The raw DDL keeps its CHECK constraints on the quantities.
      const checks = await db.execute(sql`
        select conname from pg_constraint
        where contype = 'c' and conrelid = 'purchase_order_lines'::regclass
      `);
      assert(
        (checks.rows as Array<{ conname: string }>).some((row) => /quantity/.test(row.conname)),
        "purchase_order_lines quantity CHECK constraint is missing — raw DDL did not create the table",
      );
    });

    await check("schema setup is safe to run again on existing tables (restart path)", async () => {
      await ensurePurchasingSchema();
    });

    // ---- fixtures ----
    const userRows = await db.insert(users).values({
      name: `DBTEST buyer ${run}`,
      email: `dbtest-${run}@example.test`,
      role: "Manager",
    }).returning({ id: users.id });
    const createdById = userRows[0].id;
    const itemRows = await db.insert(inventoryItems).values([
      {
        sku: `DBTEST-A-${run}`, name: `DBTEST Board ${run}`, category: "Wood & MDF Panels",
        stockQuantity: 10, unit: "sheets", unitCost: "25.00", reorderLevel: 10,
      },
      {
        sku: `DBTEST-B-${run}`, name: `DBTEST Edge ${run}`, category: "Edge Banding",
        stockQuantity: 5, unit: "meters", unitCost: "3.50", reorderLevel: 4,
      },
      {
        sku: `DBTEST-C-${run}`, name: `DBTEST Fitting ${run}`, category: "Hardware & Fittings",
        stockQuantity: 8, unit: "pcs", unitCost: "1.10", reorderLevel: 2,
      },
    ]).returning({ id: inventoryItems.id, sku: inventoryItems.sku });
    const itemA = itemRows.find((row) => row.sku === `DBTEST-A-${run}`)!;
    const itemB = itemRows.find((row) => row.sku === `DBTEST-B-${run}`)!;
    const itemC = itemRows.find((row) => row.sku === `DBTEST-C-${run}`)!;
    itemIds = itemRows.map((row) => row.id);

    // ---- supplier records ----
    let supplierAId = 0;
    await check("supplier record is created and a case-insensitive duplicate name is rejected", async () => {
      const created = await createSupplier({
        name: `${supplierPrefix} Alpha`, contactName: "Mona", phone: "01 000 000",
        email: "alpha@example.test", address: "Beirut", notes: "",
      });
      supplierAId = created.id;
      assertEq(created.active, true, "new supplier should be active");
      await expectSupplierNameDuplicate(() => createSupplier({
        name: `${supplierPrefix} ALPHA`.toUpperCase(), contactName: "", phone: "",
        email: "", address: "", notes: "",
      }));
    });

    await check("supplier update edits details and archive/reactivate keeps the record", async () => {
      const updated = await updateSupplier(supplierAId, {
        name: `${supplierPrefix} Alpha`, contactName: "Mona Khalil", phone: "01 111 111",
        email: "alpha@example.test", address: "Beirut", notes: "preferred", active: false,
      });
      assertEq(updated.active, false, "supplier should be archived");
      assertEq(updated.contactName, "Mona Khalil", "contact name should update");
      const back = await updateSupplier(supplierAId, {
        name: `${supplierPrefix} Alpha`, contactName: "Mona Khalil", phone: "01 111 111",
        email: "alpha@example.test", address: "Beirut", notes: "preferred", active: true,
      });
      assertEq(back.active, true, "supplier should reactivate");
    });

    // ---- purchase orders ----
    let po1Id = 0;
    let po1LineId = 0;
    await check("PO snapshots SKU/name/unit/price and numbers as PUR-#####", async () => {
      const order = await createPurchaseOrder({
        supplierId: supplierAId,
        expectedAt: "2026-10-15",
        notes: `DBTEST PO ${run}`,
        lines: [{ itemId: itemA.id, quantity: 10, unitPrice: "12.50" }],
      }, createdById, true);
      po1Id = order.id;
      assertEq(order.number, `PUR-${String(order.id).padStart(5, "0")}`, "PO number format");
      const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, order.id));
      assertEq(lines.length, 1, "PO line count");
      po1LineId = lines[0].id;
      assertEq(lines[0].itemSku, `DBTEST-A-${run}`, "SKU snapshot");
      assertEq(lines[0].itemName, `DBTEST Board ${run}`, "name snapshot");
      assertEq(lines[0].itemUnit, "sheets", "unit snapshot");
      assertEq(Number(lines[0].unitPrice), 12.5, "price snapshot");
    });

    await check("a nonzero price without the money grant is refused before any insert", async () => {
      await expectFailure(
        () => createPurchaseOrder({
          supplierId: supplierAId, expectedAt: null, notes: "",
          lines: [{ itemId: itemB.id, quantity: 1, unitPrice: "9.99" }],
        }, createdById, false),
        { status: 403, message: /money grant/i },
      );
    });

    await check("board shows prices, totals and supplier awaiting value with the money grant", async () => {
      const board = await purchasingBoard(true);
      const order = board.orders.find((entry) => entry.id === po1Id);
      assert(order, "PO missing from board");
      assertEq(order.status, "Open", "PO status");
      assertEq(order.lines[0].unitPrice, "12.50", "line unit price");
      assertEq(order.lines[0].lineTotal, "125.00", "line total");
      assertEq(order.total, "125.00", "order total");
      assertEq(order.awaitingQty, 10, "awaiting quantity");
      assertEq(order.awaitingValue, "125.00", "awaiting value");
      const supplier = board.suppliers.find((entry) => entry.id === supplierAId);
      assert(supplier, "supplier missing from board");
      assertEq(supplier.awaitingOrders, 1, "supplier awaiting PO count");
      assertEq(supplier.awaitingQuantity, 10, "supplier awaiting quantity");
      assertEq(supplier.awaitingValue, "125.00", "supplier awaiting value");
      const item = board.items.find((entry) => entry.id === itemA.id);
      assert(item, "item missing from board");
      assertEq(item.onOrder, 10, "item on order");
      assertEq(item.lastSupplierId, supplierAId, "last supplier for item");
    });

    await check("board hides every price, total and cost without the money grant", async () => {
      const board = await purchasingBoard(false);
      const order = board.orders.find((entry) => entry.id === po1Id);
      assert(order, "PO missing from board");
      assertEq(order.lines[0].unitPrice, null, "unit price must be hidden");
      assertEq(order.lines[0].lineTotal, null, "line total must be hidden");
      assertEq(order.total, null, "order total must be hidden");
      assertEq(order.awaitingValue, null, "awaiting value must be hidden");
      assertEq(order.awaitingQty, 10, "quantities stay visible");
      const supplier = board.suppliers.find((entry) => entry.id === supplierAId);
      assert(supplier, "supplier missing from board");
      assertEq(supplier.awaitingValue, null, "supplier awaiting value must be hidden");
      const item = board.items.find((entry) => entry.id === itemA.id);
      assert(item, "item missing from board");
      assertEq(item.unitCost, null, "unit cost must be hidden");
    });

    // ---- goods receipts ----
    await check("partial GRN writes history, increments stock and leaves the PO open", async () => {
      const key = newReceiptRequestKey();
      const result = await receivePurchaseOrder(po1Id, {
        requestKey: key, deliveryRef: `DN-${run}`, notes: "first pallet",
        lines: [{ poLineId: po1LineId, quantity: 4 }],
      }, createdById);
      assertEq(result.replayed, false, "first post is not a replay");
      assertEq(result.status, "Open", "PO stays open on a partial receipt");
      assertEq(result.number, `GRN-${String(result.id).padStart(5, "0")}`, "GRN number format");
      assertEq(await stockOf(itemA.id), 14, "stock +4");
      const receipts = await receiptsOf(po1Id);
      assertEq(receipts.length, 1, "one receipt row");
      assertEq(receipts[0].deliveryRef, `DN-${run}`, "delivery reference saved");
      const lines = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.receiptId, result.id));
      assertEq(lines[0].quantity, 4, "receipt line quantity");
    });

    await check("retrying the same request key replays without touching stock", async () => {
      const before = await receiptsOf(po1Id);
      const result = await receivePurchaseOrder(po1Id, {
        requestKey: before[0].requestKey, deliveryRef: `DN-${run}`, notes: "first pallet",
        lines: [{ poLineId: po1LineId, quantity: 4 }],
      }, createdById);
      assertEq(result.replayed, true, "second post must be a replay");
      assertEq(result.id, before[0].id, "replay returns the original GRN");
      assertEq(await stockOf(itemA.id), 14, "stock unchanged after replay");
      assertEq((await receiptsOf(po1Id)).length, 1, "still one receipt row");
    });

    await check("over-receipt is rejected and rolls back completely", async () => {
      await expectFailure(
        () => receivePurchaseOrder(po1Id, {
          requestKey: newReceiptRequestKey(), deliveryRef: "", notes: "",
          lines: [{ poLineId: po1LineId, quantity: 7 }],
        }, createdById),
        { status: 409, message: /only 6 sheets still outstanding/i },
      );
      assertEq(await stockOf(itemA.id), 14, "stock unchanged after over-receipt");
      assertEq((await receiptsOf(po1Id)).length, 1, "no receipt row added");
    });

    await check("a receipt line that is not on the PO is rejected", async () => {
      await expectFailure(
        () => receivePurchaseOrder(po1Id, {
          requestKey: newReceiptRequestKey(), deliveryRef: "", notes: "",
          lines: [{ poLineId: po1LineId + 99999, quantity: 1 }],
        }, createdById),
        { status: 400, message: /not on this purchase order/i },
      );
    });

    await check("receiving the remainder closes the PO and stops awaiting value", async () => {
      const result = await receivePurchaseOrder(po1Id, {
        requestKey: newReceiptRequestKey(), deliveryRef: "", notes: "",
        lines: [{ poLineId: po1LineId, quantity: 6 }],
      }, createdById);
      assertEq(result.status, "Closed", "fully received PO closes");
      assertEq(await stockOf(itemA.id), 20, "stock +10 in total");
      const board = await purchasingBoard(true);
      const order = board.orders.find((entry) => entry.id === po1Id);
      assert(order, "PO missing from board");
      assertEq(order.awaitingQty, 0, "nothing awaiting on a closed PO");
      assertEq(order.awaitingValue, "0.00", "awaiting value is zero");
      const supplier = board.suppliers.find((entry) => entry.id === supplierAId);
      assert(supplier, "supplier missing from board");
      assertEq(supplier.awaitingOrders, 0, "closed PO leaves the supplier awaiting list");
    });

    await check("a closed PO cannot receive goods", async () => {
      await expectFailure(
        () => receivePurchaseOrder(po1Id, {
          requestKey: newReceiptRequestKey(), deliveryRef: "", notes: "",
          lines: [{ poLineId: po1LineId, quantity: 1 }],
        }, createdById),
        { status: 409, message: /only open purchase orders/i },
      );
    });

    // ---- close / cancel rules ----
    await check("cancel rules: no-receipt PO cancels, received PO cannot, remainder can close", async () => {
      const clean = await createPurchaseOrder({
        supplierId: supplierAId, expectedAt: null, notes: `DBTEST cancel-clean ${run}`,
        lines: [{ itemId: itemB.id, quantity: 5, unitPrice: "0.00" }],
      }, createdById, false);
      const cleanLines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, clean.id));
      const cancelled = await finishPurchaseOrder(clean.id, "Cancelled");
      assertEq(cancelled.status, "Cancelled", "clean PO cancels");
      await expectFailure(
        () => receivePurchaseOrder(clean.id, {
          requestKey: newReceiptRequestKey(), deliveryRef: "", notes: "",
          lines: [{ poLineId: cleanLines[0].id, quantity: 1 }],
        }, createdById),
        { status: 409, message: /only open purchase orders/i },
      );

      const received = await createPurchaseOrder({
        supplierId: supplierAId, expectedAt: null, notes: `DBTEST cancel-received ${run}`,
        lines: [{ itemId: itemB.id, quantity: 5, unitPrice: "0.00" }],
      }, createdById, false);
      const receivedLines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, received.id));
      await receivePurchaseOrder(received.id, {
        requestKey: newReceiptRequestKey(), deliveryRef: "", notes: "",
        lines: [{ poLineId: receivedLines[0].id, quantity: 1 }],
      }, createdById);
      await expectFailure(
        () => finishPurchaseOrder(received.id, "Cancelled"),
        { status: 409, message: /cannot be cancelled/i },
      );
      const closed = await finishPurchaseOrder(received.id, "Closed");
      assertEq(closed.status, "Closed", "received remainder can be closed");
    });

    // ---- atomicity ----
    await check("one bad stock line rolls back every other line of the same GRN", async () => {
      const order = await createPurchaseOrder({
        supplierId: supplierAId, expectedAt: null, notes: `DBTEST overflow ${run}`,
        lines: [
          { itemId: itemA.id, quantity: 2, unitPrice: "0.00" },
          { itemId: itemB.id, quantity: 2, unitPrice: "0.00" },
        ],
      }, createdById, false);
      const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, order.id));
      const lineA = lines.find((line) => line.itemId === itemA.id)!;
      const lineB = lines.find((line) => line.itemId === itemB.id)!;
      await db.update(inventoryItems).set({ stockQuantity: 2_147_483_646 }).where(eq(inventoryItems.id, itemB.id));
      await expectFailure(
        () => receivePurchaseOrder(order.id, {
          requestKey: newReceiptRequestKey(), deliveryRef: "", notes: "",
          lines: [
            { poLineId: lineA.id, quantity: 2 },
            { poLineId: lineB.id, quantity: 2 },
          ],
        }, createdById),
        { status: 409, message: /overflow/i },
      );
      assertEq(await stockOf(itemA.id), 20, "first line increment rolled back with the overflow");
      assertEq(await stockOf(itemB.id), 2_147_483_646, "overflowing stock untouched");
      assertEq((await receiptsOf(order.id)).length, 0, "no receipt row survives a rollback");
      await db.update(inventoryItems).set({ stockQuantity: 6 }).where(eq(inventoryItems.id, itemB.id));
    });

    await check("a line whose stock item was deleted cannot receive", async () => {
      const order = await createPurchaseOrder({
        supplierId: supplierAId, expectedAt: null, notes: `DBTEST deleted-item ${run}`,
        lines: [{ itemId: itemC.id, quantity: 3, unitPrice: "0.00" }],
      }, createdById, false);
      const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, order.id));
      await db.delete(inventoryItems).where(eq(inventoryItems.id, itemC.id));
      const orphan = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.id, lines[0].id));
      assertEq(orphan[0].itemId, null, "deleting the item nulls the line reference but keeps the snapshot");
      assertEq(orphan[0].itemName, `DBTEST Fitting ${run}`, "name snapshot survives deletion");
      await expectFailure(
        () => receivePurchaseOrder(order.id, {
          requestKey: newReceiptRequestKey(), deliveryRef: "", notes: "",
          lines: [{ poLineId: lines[0].id, quantity: 3 }],
        }, createdById),
        { status: 409, message: /restore the item/i },
      );
    });

    // ---- concurrency ----
    await check("concurrent GRNs cannot over-receive a PO", async () => {
      const order = await createPurchaseOrder({
        supplierId: supplierAId, expectedAt: null, notes: `DBTEST concurrent ${run}`,
        lines: [{ itemId: itemA.id, quantity: 10, unitPrice: "0.00" }],
      }, createdById, false);
      const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, order.id));
      const attempts = [4, 4, 4].map((quantity) => receivePurchaseOrder(order.id, {
        requestKey: newReceiptRequestKey(), deliveryRef: "", notes: "",
        lines: [{ poLineId: lines[0].id, quantity }],
      }, createdById));
      const results = await Promise.allSettled(attempts);
      const fulfilled = results.filter((entry) => entry.status === "fulfilled");
      const rejected = results.filter((entry) => entry.status === "rejected") as PromiseRejectedResult[];
      assertEq(fulfilled.length, 2, "exactly two receipts of 4 fit into 10");
      assertEq(rejected.length, 1, "the third concurrent receipt is rejected");
      assert(
        /only \d+ sheets still outstanding/i.test(String(rejected[0].reason)),
        `unexpected rejection: ${String(rejected[0].reason)}`,
      );
      assertEq(await stockOf(itemA.id), 28, "stock +8 only");
      assertEq((await receiptsOf(order.id)).length, 2, "two receipt rows");
    });

    await check("simultaneous retries with one request key never double-stock", async () => {
      const order = await createPurchaseOrder({
        supplierId: supplierAId, expectedAt: null, notes: `DBTEST same-key ${run}`,
        lines: [{ itemId: itemA.id, quantity: 10, unitPrice: "0.00" }],
      }, createdById, false);
      const lines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, order.id));
      const requestKey = newReceiptRequestKey();
      const payload = {
        requestKey, deliveryRef: "", notes: "",
        lines: [{ poLineId: lines[0].id, quantity: 3 }],
      };
      const results = await Promise.all([
        receivePurchaseOrder(order.id, payload, createdById),
        receivePurchaseOrder(order.id, payload, createdById),
      ]);
      assertEq(results.filter((entry) => entry.replayed).length, 1, "exactly one call is served as a replay");
      assertEq(await stockOf(itemA.id), 31, "stock +3 only");
      assertEq((await receiptsOf(order.id)).length, 1, "one receipt row for the key");
    });

    await check("the same request key on a different PO is refused and cannot stock there either", async () => {
      const first = await createPurchaseOrder({
        supplierId: supplierAId, expectedAt: null, notes: `DBTEST keypo-a ${run}`,
        lines: [{ itemId: itemA.id, quantity: 5, unitPrice: "0.00" }],
      }, createdById, false);
      const second = await createPurchaseOrder({
        supplierId: supplierAId, expectedAt: null, notes: `DBTEST keypo-b ${run}`,
        lines: [{ itemId: itemA.id, quantity: 5, unitPrice: "0.00" }],
      }, createdById, false);
      const firstLines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, first.id));
      const secondLines = await db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, second.id));
      const requestKey = newReceiptRequestKey();
      const results = await Promise.allSettled([
        receivePurchaseOrder(first.id, {
          requestKey, deliveryRef: "", notes: "",
          lines: [{ poLineId: firstLines[0].id, quantity: 3 }],
        }, createdById),
        receivePurchaseOrder(second.id, {
          requestKey, deliveryRef: "", notes: "",
          lines: [{ poLineId: secondLines[0].id, quantity: 3 }],
        }, createdById),
      ]);
      const fulfilled = results.filter((entry) => entry.status === "fulfilled");
      const rejected = results.filter((entry) => entry.status === "rejected") as PromiseRejectedResult[];
      assertEq(fulfilled.length, 1, "only one PO keeps the receipt");
      assertEq(rejected.length, 1, "the other PO is refused");
      assert(
        /different purchase order/i.test(String(rejected[0].reason)),
        `unexpected rejection: ${String(rejected[0].reason)}`,
      );
      assertEq(await stockOf(itemA.id), 34, "stock +3 only, once");
    });
  } finally {
    // Best-effort cleanup so the scratch database can be reused.
    try {
      await db.execute(sql`
        delete from goods_receipt_lines gl using goods_receipts gr, purchase_orders po, suppliers s
        where gl.receipt_id = gr.id and gr.order_id = po.id and po.supplier_id = s.id
          and s.name like ${supplierPrefix + "%"}`);
      await db.execute(sql`
        delete from goods_receipts gr using purchase_orders po, suppliers s
        where gr.order_id = po.id and po.supplier_id = s.id and s.name like ${supplierPrefix + "%"}`);
      await db.execute(sql`
        delete from purchase_order_lines pl using purchase_orders po, suppliers s
        where pl.order_id = po.id and po.supplier_id = s.id and s.name like ${supplierPrefix + "%"}`);
      await db.execute(sql`
        delete from purchase_orders po using suppliers s
        where po.supplier_id = s.id and s.name like ${supplierPrefix + "%"}`);
      await db.delete(suppliers).where(sql`${suppliers.name} like ${supplierPrefix + "%"}`);
      await db.delete(inventoryItems).where(inArray(inventoryItems.id, itemIdsSafe(itemIds)));
      await db.delete(users).where(eq(users.email, `dbtest-${run}@example.test`));
    } catch (error) {
      console.log(`note: cleanup incomplete: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(failed === 0 ? "ALL PASS" : `${failed} CHECK(S) FAILED`);
  console.log(`PASS ${passed} FAIL ${failed}`);
}

function itemIdsSafe(ids: number[]): number[] {
  return ids.filter((id) => Number.isSafeInteger(id) && id > 0);
}

main()
  .catch((error) => {
    failed++;
    console.log("FAIL: purchasing-db: suite crashed");
    console.log(`      ${error instanceof Error ? error.stack : String(error)}`);
    console.log(`PASS ${passed} FAIL ${failed}`);
  })
  .finally(() => pool.end())
  .then(() => process.exit(failed > 0 ? 1 : 0));
