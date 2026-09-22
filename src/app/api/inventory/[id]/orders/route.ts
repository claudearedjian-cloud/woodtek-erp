import { NextResponse } from "next/server";
import { db } from "@/db";
import { orderMaterials, orders, customers, orderOperations, inventoryItems } from "@/db/schema";
import { eq, and, isNull, ne, or, desc, inArray } from "drizzle-orm";
import { authorize } from "@/lib/auth";

/**
 * Returns ALL orders that have ever allocated the given inventory item,
 * including completed and delivered ones (their allocations appear in the
 * "consumed" history list), so the owner sees every order that used the material.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { error } = await authorize("inventory:read");
  if (error) return error;

  try {
    const { id } = await context.params;
    const itemId = Number(id);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return NextResponse.json({ error: "Invalid item id" }, { status: 400 });
    }

    // All open orders (not Completed/Cancelled) that have a non-released,
    // non-consumed allocation for this item.
    const allocs = await db
      .select({
        allocationId: orderMaterials.id,
        orderId: orders.id,
        orderNumber: orders.orderNumber,
        orderTitle: orders.title,
        orderStatus: orders.status,
        orderPriority: orders.priority,
        orderDueDate: orders.dueDate,
        orderProgress: orders.progressPercent,
        customerName: customers.name,
        customerCompany: customers.company,
        quantityUsed: orderMaterials.quantityUsed,
        costPerUnit: orderMaterials.costPerUnit,
        consumed: orderMaterials.consumed,
        released: orderMaterials.released,
      })
      .from(orderMaterials)
      .innerJoin(orders, eq(orders.id, orderMaterials.orderId))
      .leftJoin(customers, eq(customers.id, orders.customerId))
      .where(eq(orderMaterials.itemId, itemId))
      .orderBy(orders.dueDate);

    // Partition: active (still reserving, not consumed nor released) vs
    // history (consumed by the order, or released with it - completed,
    // delivered and cancelled orders all appear here).
    const active = allocs.filter((a) => !a.consumed && !a.released);
    const consumed = allocs.filter((a) => a.consumed || a.released);

    return NextResponse.json({
      itemId,
      active: active.map((a) => ({
        ...a,
        // Compute remaining for each active allocation
        remaining: a.quantityUsed, // all of it is still "in use" until consumed
      })),
      consumed,
    });
  } catch (error: any) {
    console.error("GET inventory orders error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to fetch orders for this material" },
      { status: 500 },
    );
  }
}
