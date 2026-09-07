import { NextResponse } from "next/server";
import { db } from "@/db";
import { orderMaterials, orders, customers, orderOperations, inventoryItems } from "@/db/schema";
import { eq, and, isNull, ne, or, desc, inArray } from "drizzle-orm";
import { authorize } from "@/lib/auth";

/**
 * Returns all open orders that have allocated the given inventory item,
 * along with how much they reserved and how much is still unconsumed.
 *
 * Used by the inventory page to answer: "Which orders are using this material?"
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
      .where(
        and(
          eq(orderMaterials.itemId, itemId),
          eq(orderMaterials.released, false),
          or(
            eq(orderMaterials.consumed, false),
            isNull(orderMaterials.consumed),
          ),
          ne(orders.status, "Cancelled"),
        ),
      )
      .orderBy(orders.dueDate);

    // Partition: active (not consumed yet) vs consumed (already used up)
    const active = allocs.filter((a) => !a.consumed);
    const consumed = allocs.filter((a) => a.consumed);

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
