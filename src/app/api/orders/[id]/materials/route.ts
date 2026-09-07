import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orderMaterials, inventoryItems, orders } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { applyMaterialsStatus, computeAvailability } from "@/lib/materials";

/**
 * Bill-of-materials allocation. The stock is RESERVED (not deducted) on
 * allocation, and is only CONSUMED when the order is marked Completed.
 *
 * Each write runs inside a single transaction so a race between two
 * operators can never oversell the same sheet of MDF.
 */

async function loadOrderMaterials(orderId: number) {
  return db
    .select({
      id: orderMaterials.id,
      itemId: orderMaterials.itemId,
      itemName: inventoryItems.name,
      itemSku: inventoryItems.sku,
      itemUnit: inventoryItems.unit,
      itemCategory: inventoryItems.category,
      itemStockRemaining: inventoryItems.stockQuantity,
      itemReorderLevel: inventoryItems.reorderLevel,
      quantityUsed: orderMaterials.quantityUsed,
      costPerUnit: orderMaterials.costPerUnit,
      consumed: orderMaterials.consumed,
      consumedAt: orderMaterials.consumedAt,
      released: orderMaterials.released,
      releasedAt: orderMaterials.releasedAt,
    })
    .from(orderMaterials)
    .leftJoin(inventoryItems, eq(orderMaterials.itemId, inventoryItems.id))
    .where(eq(orderMaterials.orderId, orderId));
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authorize("orders:read");
  if (error) return error;
  try {
    const { id } = await context.params;
    return NextResponse.json(await loadOrderMaterials(Number(id)));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to fetch BOM";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  // Allocating stock to an order is a planning/management task - Manager or Sales only.
  const { error } = await authorize("materials:write");
  if (error) return error;

  try {
    const { id } = await context.params;
    const orderId = Number(id);
    const body = await request.json();
    const itemId = Number(body.itemId);
    const quantity = Math.floor(Number(body.quantityUsed));

    if (!Number.isInteger(itemId) || itemId <= 0) {
      return NextResponse.json({ error: "Please choose a stock item." }, { status: 400 });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json({ error: "Enter a positive whole quantity." }, { status: 400 });
    }

    const [orderRow] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId));
    if (!orderRow) return NextResponse.json({ error: "Order not found." }, { status: 404 });

    // Block allocation if the order is already Completed or Cancelled
    if (orderRow.id && (await isTerminal(orderId))) {
      return NextResponse.json(
        { error: "Cannot allocate materials to a completed or cancelled order." },
        { status: 409 },
      );
    }

    // Atomic transaction:
    //   1. Look up the item and check that reserving N units won't put us
    //      below zero (considering other active reservations on the same item)
    //   2. Upsert the order_materials row (re-uses an existing allocation
    //      for the same item, otherwise creates a new one)
    //   3. Recompute the order's materials_status
    //
    // NOTE: stockQuantity is NOT debited here. It is only debited when the
    // order is marked Completed, by the consumeMaterialsForOrder() helper.
    await db.transaction(async (tx) => {
      const [item] = await tx.select().from(inventoryItems).where(eq(inventoryItems.id, itemId));
      if (!item) throw Object.assign(new Error("Stock item not found."), { httpStatus: 404 });

      // What is the available stock considering all active reservations
      // (excluding the current allocation, if any)?
      const availability = await computeAvailability();
      const itemAvail = availability.get(itemId) || {
        stockQuantity: Number(item.stockQuantity) || 0,
        reserved: 0,
        available: Number(item.stockQuantity) || 0,
      };
      const [existing] = await tx
        .select()
        .from(orderMaterials)
        .where(and(eq(orderMaterials.orderId, orderId), eq(orderMaterials.itemId, itemId)));
      const existingQty = existing && !existing.released ? existing.quantityUsed : 0;
      const additionalRequired = quantity - existingQty;

      if (additionalRequired > itemAvail.available) {
        throw Object.assign(
          new Error(
            `Insufficient stock for ${item.sku}. ` +
              `On hand: ${itemAvail.stockQuantity}, ` +
              `Reserved by other orders: ${itemAvail.reserved}, ` +
              `Available now: ${itemAvail.available}. ` +
              `Requested additional: ${additionalRequired}.`,
          ),
          { httpStatus: 409 },
        );
      }

      if (existing) {
        if (existing.released) {
          // A previously released allocation - re-use it (mark active again)
          await tx
            .update(orderMaterials)
            .set({
              quantityUsed: quantity,
              costPerUnit: item.unitCost,
              released: false,
              releasedAt: null,
            })
            .where(eq(orderMaterials.id, existing.id));
        } else {
          await tx
            .update(orderMaterials)
            .set({ quantityUsed: quantity, costPerUnit: item.unitCost })
            .where(eq(orderMaterials.id, existing.id));
        }
      } else {
        await tx.insert(orderMaterials).values({
          orderId,
          itemId,
          quantityUsed: quantity,
          costPerUnit: item.unitCost,
        });
      }
    });

    // Recompute the order's materials status
    const newStatus = await applyMaterialsStatus(orderId);

    return NextResponse.json({
      success: true,
      materials: await loadOrderMaterials(orderId),
      materialsStatus: newStatus,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to allocate material";
    const status = (err as { httpStatus?: number })?.httpStatus ?? 500;
    if (status >= 500) console.error("POST material allocation error:", err);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authorize("materials:write");
  if (error) return error;

  try {
    const { id } = await context.params;
    const orderId = Number(id);
    const url = new URL(request.url);
    const allocationId = Number(url.searchParams.get("allocationId"));

    if (!Number.isInteger(allocationId) || allocationId <= 0) {
      return NextResponse.json({ error: "Allocation ID is required." }, { status: 400 });
    }

    let newStatus: string = "unknown";

    await db.transaction(async (tx) => {
      const [allocation] = await tx
        .select()
        .from(orderMaterials)
        .where(and(eq(orderMaterials.orderId, orderId), eq(orderMaterials.id, allocationId)));
      if (!allocation) throw Object.assign(new Error("Allocation not found on this order."), { httpStatus: 404 });

      // SAFETY: block deletion of consumed materials - you can only release
      // them by first adding stock back to the inventory (via a stock
      // adjustment in the inventory page).
      if (allocation.consumed) {
        throw Object.assign(
          new Error(
            "This material has already been consumed (the order is completed). " +
              "It cannot be removed from the BOM. To re-add stock, create a stock adjustment.",
          ),
          { httpStatus: 409 },
        );
      }

      // If the allocation was already released, this is a no-op; just delete it.
      if (!allocation.released) {
        // Mark as released (does NOT return stock to inventory - it was only
        // reserved, not consumed).
        await tx
          .update(orderMaterials)
          .set({ released: true, releasedAt: new Date() })
          .where(eq(orderMaterials.id, allocationId));
      } else {
        // Was already released: clean up the row entirely
        await tx.delete(orderMaterials).where(eq(orderMaterials.id, allocationId));
      }
    });

    // Recompute the order's materials status
    newStatus = await applyMaterialsStatus(orderId);

    return NextResponse.json({
      success: true,
      materials: await loadOrderMaterials(orderId),
      materialsStatus: newStatus,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to release material";
    const status = (err as { httpStatus?: number })?.httpStatus ?? 500;
    if (status >= 500) console.error("DELETE material allocation error:", err);
    return NextResponse.json({ error: message }, { status });
  }
}

async function isTerminal(orderId: number): Promise<boolean> {
  const [o] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId));
  return o?.status === "Completed" || o?.status === "Cancelled";
}
