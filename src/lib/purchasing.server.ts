// Purchasing persistence (server only). PO lines and GRNs are append-only.
// A receipt's immutable history and additive inventory updates share one
// PostgreSQL transaction; a PO row lock prevents concurrent over-receipts.
import { db } from "@/db";
import {
  goodsReceiptLines, goodsReceipts, inventoryItems, purchaseOrderLines,
  purchaseOrders, suppliers,
} from "@/db/schema";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  PurchasingError, parseGoodsReceipt, parsePurchaseOrder, parseSupplier,
  summarizeOrderLines, type PurchaseLineSnapshot,
} from "@/lib/purchasing";
import { ensurePurchasingSchema } from "@/lib/purchasingSchema.server";

export async function purchasingBoard(maySeeMoney: boolean) {
  await ensurePurchasingSchema();
  // One repeatable-read snapshot: do not show half a GRN (receipt header from
  // one instant and stock / receipt lines from another) on the awaiting board.
  // The reads run sequentially on the transaction's single connection —
  // node-postgres deprecates (pg@9 rejects) parallel queries on one client.
  const [supplierRows, orderRows, lines, receipts, receiptLines, stock] = await db.transaction(async (tx) => {
    const supplierRows = await tx.select().from(suppliers).orderBy(asc(suppliers.name));
    const orderRows = await tx.select().from(purchaseOrders).orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id));
    const lines = await tx.select().from(purchaseOrderLines);
    const receipts = await tx.select().from(goodsReceipts).orderBy(desc(goodsReceipts.receivedAt), desc(goodsReceipts.id));
    const receiptLines = await tx.select().from(goodsReceiptLines);
    const stock = await tx.select({
      id: inventoryItems.id, sku: inventoryItems.sku, name: inventoryItems.name,
      unit: inventoryItems.unit, stockQuantity: inventoryItems.stockQuantity,
      reorderLevel: inventoryItems.reorderLevel, unitCost: inventoryItems.unitCost,
    }).from(inventoryItems).orderBy(asc(inventoryItems.name));
    return [supplierRows, orderRows, lines, receipts, receiptLines, stock] as const;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  const byOrder = new Map<number, typeof lines>();
  for (const line of lines) {
    const list = byOrder.get(line.orderId) ?? [];
    list.push(line);
    byOrder.set(line.orderId, list);
  }
  const byReceipt = new Map<number, typeof receiptLines>();
  for (const line of receiptLines) {
    const list = byReceipt.get(line.receiptId) ?? [];
    list.push(line);
    byReceipt.set(line.receiptId, list);
  }
  const byOrderReceipts = new Map<number, typeof receipts>();
  for (const receipt of receipts) {
    const list = byOrderReceipts.get(receipt.orderId) ?? [];
    list.push(receipt);
    byOrderReceipts.set(receipt.orderId, list);
  }
  const supplierById = new Map(supplierRows.map((s) => [s.id, s]));
  const awaiting = new Map<number, { orders: number; quantity: number; valueCents: number }>();
  const onOrder = new Map<number, number>();
  const lastSupplierForItem = new Map<number, number>();
  const orders = orderRows.map((order) => {
    const purchaseLines = byOrder.get(order.id) ?? [];
    const history = byOrderReceipts.get(order.id) ?? [];
    const receivedLines = history.flatMap((r) => byReceipt.get(r.id) ?? []);
    const summary = summarizeOrderLines(purchaseLines as PurchaseLineSnapshot[], receivedLines, order.status, maySeeMoney);
    for (const line of summary.lines) {
      if (line.itemId !== null) {
        if (!lastSupplierForItem.has(line.itemId) && supplierById.get(order.supplierId)?.active) {
          lastSupplierForItem.set(line.itemId, order.supplierId);
        }
        if (order.status === "Open") onOrder.set(line.itemId, (onOrder.get(line.itemId) ?? 0) + line.remainingQuantity);
      }
    }
    if (order.status === "Open" && summary.awaitingQty > 0) {
      const prev = awaiting.get(order.supplierId) ?? { orders: 0, quantity: 0, valueCents: 0 };
      prev.orders++;
      prev.quantity += summary.awaitingQty;
      prev.valueCents += Math.round(Number(summary.awaitingValue ?? 0) * 100);
      awaiting.set(order.supplierId, prev);
    }
    return {
      ...order,
      number: `PUR-${String(order.id).padStart(5, "0")}`,
      supplierName: supplierById.get(order.supplierId)?.name ?? "Supplier unavailable",
      ...summary,
      receipts: history.map((r) => ({
        ...r,
        number: `GRN-${String(r.id).padStart(5, "0")}`,
        lines: (byReceipt.get(r.id) ?? []).map((l) => ({
          poLineId: l.poLineId, quantity: l.quantity,
          itemName: purchaseLines.find((p) => p.id === l.poLineId)?.itemName ?? "Stock item",
        })),
      })),
    };
  });

  return {
    suppliers: supplierRows.map((s) => {
      const pending = awaiting.get(s.id);
      return {
        ...s,
        awaitingOrders: pending?.orders ?? 0,
        awaitingQuantity: pending?.quantity ?? 0,
        awaitingValue: maySeeMoney ? ((pending?.valueCents ?? 0) / 100).toFixed(2) : null,
      };
    }),
    orders,
    items: stock.map((s) => ({
      ...s,
      unitCost: maySeeMoney ? s.unitCost : null,
      onOrder: onOrder.get(s.id) ?? 0,
      lastSupplierId: lastSupplierForItem.get(s.id) ?? null,
    })),
    canSeeMoney: maySeeMoney,
  };
}

export async function createSupplier(input: unknown) {
  const values = parseSupplier(input);
  await ensurePurchasingSchema();
  const [created] = await db.insert(suppliers).values(values).returning();
  return created;
}

export async function updateSupplier(id: number, input: unknown) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
  if (!raw) throw new PurchasingError("Enter supplier details.");
  if (raw.active !== undefined && typeof raw.active !== "boolean") throw new PurchasingError("Active must be true or false.");
  const values = parseSupplier(raw);
  await ensurePurchasingSchema();
  const [updated] = await db.update(suppliers)
    .set({ ...values, ...(raw.active !== undefined ? { active: raw.active as boolean } : {}) })
    .where(eq(suppliers.id, id)).returning();
  if (!updated) throw new PurchasingError("Supplier not found.", 404);
  return updated;
}

export async function createPurchaseOrder(input: unknown, createdById: number, maySeeMoney: boolean) {
  const payload = parsePurchaseOrder(input, maySeeMoney);
  await ensurePurchasingSchema();
  return db.transaction(async (tx) => {
    const [supplier] = await tx.select({ id: suppliers.id, active: suppliers.active })
      .from(suppliers).where(eq(suppliers.id, payload.supplierId)).for("share");
    if (!supplier || !supplier.active) throw new PurchasingError("Choose an active supplier.", 409);
    // Shared locks protect the SKU/name/unit snapshots against a concurrent
    // delete or rename until the PO lines have committed.
    const items = await tx.select({
      id: inventoryItems.id, sku: inventoryItems.sku,
      name: inventoryItems.name, unit: inventoryItems.unit,
    }).from(inventoryItems).where(inArray(inventoryItems.id, payload.lines.map((l) => l.itemId))).for("share");
    if (items.length !== payload.lines.length) throw new PurchasingError("A stock item was removed. Refresh the form and try again.", 409);
    const byId = new Map(items.map((i) => [i.id, i]));
    const [order] = await tx.insert(purchaseOrders).values({
      supplierId: supplier.id, createdById, expectedAt: payload.expectedAt,
      notes: payload.notes, status: "Open",
    }).returning({ id: purchaseOrders.id });
    await tx.insert(purchaseOrderLines).values(payload.lines.map((line) => {
      const item = byId.get(line.itemId)!;
      return {
        orderId: order.id, itemId: item.id,
        itemSku: item.sku, itemName: item.name, itemUnit: item.unit,
        quantity: line.quantity, unitPrice: line.unitPrice,
      };
    }));
    return { id: order.id, number: `PUR-${String(order.id).padStart(5, "0")}` };
  });
}

export async function finishPurchaseOrder(id: number, status: unknown) {
  if (status !== "Closed" && status !== "Cancelled") throw new PurchasingError("Choose Close or Cancel.");
  await ensurePurchasingSchema();
  return db.transaction(async (tx) => {
    const [order] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for("update");
    if (!order) throw new PurchasingError("Purchase order not found.", 404);
    if (order.status !== "Open") throw new PurchasingError("This purchase order is already closed or cancelled.", 409);
    if (status === "Cancelled") {
      const [receipt] = await tx.select({ id: goodsReceipts.id }).from(goodsReceipts)
        .where(eq(goodsReceipts.orderId, id)).limit(1);
      if (receipt) throw new PurchasingError("A PO with received goods cannot be cancelled. Close the remaining quantity instead.", 409);
    }
    await tx.update(purchaseOrders).set({ status }).where(eq(purchaseOrders.id, id));
    return { id, status };
  });
}

export async function receivePurchaseOrder(id: number, input: unknown, receivedById: number) {
  const payload = parseGoodsReceipt(input);
  await ensurePurchasingSchema();
  try {
    return await db.transaction(async (tx) => {
      // Lock the PO BEFORE checking receipt totals. Every concurrent GRN or
      // close/cancel operation serializes on the same row.
      const [order] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for("update");
      if (!order) throw new PurchasingError("Purchase order not found.", 404);
      const [existing] = await tx.select().from(goodsReceipts).where(eq(goodsReceipts.requestKey, payload.requestKey));
      if (existing) {
        if (existing.orderId !== id) throw new PurchasingError("Receipt key belongs to a different purchase order.", 409);
        return { id: existing.id, number: `GRN-${String(existing.id).padStart(5, "0")}`, replayed: true, status: order.status };
      }
      if (order.status !== "Open") throw new PurchasingError("Only open purchase orders can receive goods.", 409);

      const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, id));
      const previous = await tx.select({ poLineId: goodsReceiptLines.poLineId, quantity: goodsReceiptLines.quantity })
        .from(goodsReceiptLines).innerJoin(goodsReceipts, eq(goodsReceiptLines.receiptId, goodsReceipts.id))
        .where(eq(goodsReceipts.orderId, id));
      const summary = summarizeOrderLines(lines as PurchaseLineSnapshot[], previous, "Open", false);
      const byId = new Map(summary.lines.map((line) => [line.id, line]));
      for (const requested of payload.lines) {
        const line = byId.get(requested.poLineId);
        if (!line) throw new PurchasingError("A receipt line is not on this purchase order.", 400);
        if (requested.quantity > line.remainingQuantity) {
          throw new PurchasingError(`${line.itemName}: only ${line.remainingQuantity} ${line.itemUnit} still outstanding. Refresh and retry.`, 409);
        }
        if (line.itemId === null) throw new PurchasingError(`${line.itemName} was deleted from stock; restore the item before receiving it.`, 409);
      }

      const [receipt] = await tx.insert(goodsReceipts).values({
        orderId: id, requestKey: payload.requestKey, receivedById,
        deliveryRef: payload.deliveryRef, notes: payload.notes,
      }).returning({ id: goodsReceipts.id });
      await tx.insert(goodsReceiptLines).values(payload.lines.map((l) => ({
        receiptId: receipt.id, poLineId: l.poLineId, quantity: l.quantity,
      })));
      for (const requested of payload.lines) {
        const itemId = byId.get(requested.poLineId)!.itemId!;
        const [updated] = await tx.update(inventoryItems)
          .set({ stockQuantity: sql`${inventoryItems.stockQuantity} + ${requested.quantity}` })
          .where(and(
            eq(inventoryItems.id, itemId),
            sql`${inventoryItems.stockQuantity} >= 0 and ${inventoryItems.stockQuantity} <= ${2_147_483_647 - requested.quantity}`,
          ))
          .returning({ id: inventoryItems.id });
        if (!updated) throw new PurchasingError("Stock item unavailable or quantity would overflow; no goods were received.", 409);
      }
      const fullyReceived = summary.lines.every((line) => {
        const now = payload.lines.find((entry) => entry.poLineId === line.id)?.quantity ?? 0;
        return line.remainingQuantity === now;
      });
      if (fullyReceived) await tx.update(purchaseOrders).set({ status: "Closed" }).where(eq(purchaseOrders.id, id));
      return { id: receipt.id, number: `GRN-${String(receipt.id).padStart(5, "0")}`, replayed: false, status: fullyReceived ? "Closed" : "Open" };
    });
  } catch (error) {
    // Two simultaneous retries with the SAME request key (especially against
    // different POs) can race on its unique constraint. Only report a replay
    // after the winning transaction has committed; never write stock twice.
    const pg = error as { code?: string; cause?: { code?: string } };
    if (pg.code === "23505" || pg.cause?.code === "23505") {
      const [existing] = await db.select().from(goodsReceipts).where(eq(goodsReceipts.requestKey, payload.requestKey));
      if (existing?.orderId === id) {
        const [order] = await db.select({ status: purchaseOrders.status }).from(purchaseOrders).where(eq(purchaseOrders.id, id));
        return { id: existing.id, number: `GRN-${String(existing.id).padStart(5, "0")}`, replayed: true, status: order?.status ?? "Open" };
      }
      if (existing) throw new PurchasingError("Receipt key belongs to a different purchase order.", 409);
    }
    throw error;
  }
}
