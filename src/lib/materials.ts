// src/lib/materials.ts
// ============================================================================
// Material accounting for orders
// ----------------------------------------------------------------------------
// Handles the "stock reservation" lifecycle:
//   1. ALLOCATE: order_materials row is created; stock is "reserved" but not
//                deducted from the real stockQuantity
//   2. CONSUME:  when the order is marked Completed, the reservation is
//                converted to actual consumption; stockQuantity is debited
//                and a row in material_consumptions is written
//   3. RELEASE:  if the order is cancelled, allocated materials are released
//                and stock returns to fully available
//
// Also exposes:
//   - computeAvailability(): returns real "available" stock per item
//                            (stockQuantity minus active reservations)
//   - computeOrderMaterialsStatus(): classifies an order as
//                                    'in_stock' | 'partial' | 'out_of_stock'
//   - applyMaterialsStatus(): updates the order's cached materialsStatus
// ============================================================================

import { db } from "@/db";
import {
  orders,
  orderMaterials,
  orderOperations,
  inventoryItems,
  materialConsumptions,
  users,
} from "@/db/schema";
import { and, eq, inArray, isNull, ne, or, sql, sum } from "drizzle-orm";

export type MaterialsStatus = "unknown" | "in_stock" | "partial" | "out_of_stock" | "consumed";

// -------------------------------------------------------------------- helpers

/**
 * Returns a map: itemId -> reservedQuantity (sum of non-released, non-consumed
 * allocations across all open orders).
 */
export async function computeReservationsByItem(): Promise<Map<number, number>> {
  const rows = await db
    .select({
      itemId: orderMaterials.itemId,
      reserved: sum(orderMaterials.quantityUsed).as("reserved"),
    })
    .from(orderMaterials)
    .innerJoin(orders, eq(orders.id, orderMaterials.orderId))
    .where(
      and(
        eq(orderMaterials.consumed, false),
        eq(orderMaterials.released, false),
        // Only count allocations for orders that are still active
        ne(orders.status, "Completed"),
        ne(orders.status, "On Hold"),
        ne(orders.status, "Cancelled"),
      ),
    )
    .groupBy(orderMaterials.itemId);

  const map = new Map<number, number>();
  for (const r of rows) {
    map.set(r.itemId, Number(r.reserved) || 0);
  }
  return map;
}

/**
 * Returns a map: itemId -> { stockQuantity, reserved, available } for all items.
 * `available` is the stock minus reservations (never goes below 0 for display).
 */
export async function computeAvailability(): Promise<
  Map<number, { stockQuantity: number; reserved: number; available: number }>
> {
  const items = await db.select().from(inventoryItems);
  const reservations = await computeReservationsByItem();
  const map = new Map();
  for (const it of items) {
    const reserved = reservations.get(it.id) || 0;
    const stock = Number(it.stockQuantity) || 0;
    map.set(it.id, {
      stockQuantity: stock,
      reserved,
      available: Math.max(0, stock - reserved),
    });
  }
  return map;
}

/**
 * Computes the materialsStatus for a single order by comparing its
 * allocations against current stock + reservations.
 *
 * Returns "consumed" if every material has been consumed; "in_stock" if
 * every allocation can be fulfilled; "partial" if some can and some can't;
 * "out_of_stock" if none can; "unknown" if there are no allocations.
 */
export async function computeOrderMaterialsStatus(orderId: number): Promise<MaterialsStatus> {
  const allocs = await db
    .select()
    .from(orderMaterials)
    .where(eq(orderMaterials.orderId, orderId));

  if (allocs.length === 0) return "unknown";
  if (allocs.every((a) => a.consumed)) return "consumed";

  const itemIds = allocs.map((a) => a.itemId);
  const stockRows = await db
    .select({ id: inventoryItems.id, stockQuantity: inventoryItems.stockQuantity })
    .from(inventoryItems)
    .where(inArray(inventoryItems.id, itemIds));

  // For each allocation, the available stock is currentStock - allOtherReservations
  // (where "other reservations" are non-consumed, non-released allocations for
  // THIS allocation's item, EXCLUDING this one).
  let anyAvailable = false;
  let anyShortage = false;

  for (const a of allocs) {
    if (a.released) continue;  // already released
    const stock = stockRows.find((s) => s.id === a.itemId);
    if (!stock) { anyShortage = true; continue; }
    const totalStock = Number(stock.stockQuantity) || 0;
    // Find other active reservations for the same item (across all orders)
    const otherReservationsRows = await db
      .select({ q: sum(orderMaterials.quantityUsed).as("q") })
      .from(orderMaterials)
      .innerJoin(orders, eq(orders.id, orderMaterials.orderId))
      .where(
        and(
          eq(orderMaterials.itemId, a.itemId),
          eq(orderMaterials.consumed, false),
          eq(orderMaterials.released, false),
          ne(orders.status, "Completed"),
          ne(orders.status, "On Hold"),
          ne(orders.status, "Cancelled"),
          ne(orderMaterials.id, a.id),  // exclude this one
        ),
      );
    const other = Number(otherReservationsRows[0]?.q) || 0;
    const availableForThis = Math.max(0, totalStock - other);
    if (availableForThis >= a.quantityUsed) {
      anyAvailable = true;
    } else {
      anyShortage = true;
    }
  }

  if (anyShortage && anyAvailable) return "partial";
  if (anyShortage && !anyAvailable) return "out_of_stock";
  if (anyAvailable) return "in_stock";
  return "unknown";
}

/**
 * Persists the computed status onto the order row.
 */
export async function applyMaterialsStatus(orderId: number): Promise<MaterialsStatus> {
  const status = await computeOrderMaterialsStatus(orderId);
  await db
    .update(orders)
    .set({ materialsStatus: status })
    .where(eq(orders.id, orderId));
  return status;
}

// -------------------------------------------------------------------- lifecycle

/**
 * Consume materials for an order that is being marked Completed.
 * For every non-released, non-consumed allocation:
 *   1. Subtract the quantity from the inventory item's stockQuantity
 *   2. Mark the allocation as consumed + set consumedAt
 *   3. Write a row to material_consumptions (audit trail)
 *   4. Mark the order's materialsStatus as 'consumed'
 *
 * Runs inside a single transaction. If any step fails, everything rolls back.
 */
export async function consumeMaterialsForOrder(
  orderId: number,
  consumedByUserId: number | null,
  options: { operationId?: number; notes?: string } = {}
): Promise<{ consumed: number; totalUnits: number }> {
  return db.transaction(async (tx) => {
    const allocs = await tx
      .select()
      .from(orderMaterials)
      .where(
        and(
          eq(orderMaterials.orderId, orderId),
          eq(orderMaterials.consumed, false),
          eq(orderMaterials.released, false),
        ),
      );

    let totalUnits = 0;
    for (const a of allocs) {
      totalUnits += a.quantityUsed;
      // 1. Decrement stock
      await tx
        .update(inventoryItems)
        .set({
          stockQuantity: sql`GREATEST(0, ${inventoryItems.stockQuantity} - ${a.quantityUsed})`,
        })
        .where(eq(inventoryItems.id, a.itemId));
      // 2. Mark allocation consumed
      await tx
        .update(orderMaterials)
        .set({ consumed: true, consumedAt: new Date() })
        .where(eq(orderMaterials.id, a.id));
      // 3. Audit log
      await tx.insert(materialConsumptions).values({
        orderId,
        itemId: a.itemId,
        quantity: a.quantityUsed,
        consumedBy: consumedByUserId ?? null,
        operationId: options.operationId ?? null,
        notes: options.notes ?? null,
      });
    }

    // 4. Mark the order as fully consumed (only when there were allocations;
    //    an order with no materials keeps its previous status)
    if (allocs.length > 0) {
      await tx
        .update(orders)
        .set({ materialsStatus: "consumed" })
        .where(eq(orders.id, orderId));
    }

    return { consumed: allocs.length, totalUnits };
  });
}

/**
 * Release materials for an order that is being cancelled or paused.
 * For every non-released, non-consumed allocation: mark released + releasedAt.
 * Stock is NOT debited (it was only reserved, not consumed).
 */
export async function releaseMaterialsForOrder(orderId: number): Promise<{ released: number }> {
  return db.transaction(async (tx) => {
    const allocs = await tx
      .select()
      .from(orderMaterials)
      .where(
        and(
          eq(orderMaterials.orderId, orderId),
          eq(orderMaterials.consumed, false),
          eq(orderMaterials.released, false),
        ),
      );

    for (const a of allocs) {
      await tx
        .update(orderMaterials)
        .set({ released: true, releasedAt: new Date() })
        .where(eq(orderMaterials.id, a.id));
    }

    // Reset the order's materials_status - it will be recomputed on next allocation
    await tx
      .update(orders)
      .set({ materialsStatus: "unknown" })
      .where(eq(orders.id, orderId));

    return { released: allocs.length };
  });
}

/**
 * Returned to the order creator when they want to know if a material
 * they intend to allocate is available.
 */
export async function checkAvailabilityForAllocation(
  itemId: number,
  quantity: number
): Promise<{ available: boolean; stockQuantity: number; reserved: number; missing: number }> {
  const [item] = await db
    .select({ stockQuantity: inventoryItems.stockQuantity })
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId));
  if (!item) return { available: false, stockQuantity: 0, reserved: 0, missing: quantity };

  const stock = Number(item.stockQuantity) || 0;
  const reserved = (await computeReservationsByItem()).get(itemId) || 0;
  const available = Math.max(0, stock - reserved);
  return {
    available: available >= quantity,
    stockQuantity: stock,
    reserved,
    missing: Math.max(0, quantity - available),
  };
}
