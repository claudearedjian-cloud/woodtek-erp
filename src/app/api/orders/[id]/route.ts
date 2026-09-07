import { NextResponse } from "next/server";
import { db } from "@/db";
import { orders, customers, orderOperations, orderMaterials, machines, users, inventoryItems, materialConsumptions } from "@/db/schema";
import { eq, asc, sql } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { isFloorRole } from "@/lib/dataAccess";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error: authError } = await authorize("orders:read");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await context.params;
    const orderId = Number(id);

    const [order] = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        title: orders.title,
        projectType: orders.projectType,
        priority: orders.priority,
        status: orders.status,
        totalValue: orders.totalValue,
        dueDate: orders.dueDate,
        progressPercent: orders.progressPercent,
        notes: orders.notes,
        createdAt: orders.createdAt,
        customerId: orders.customerId,
        customerName: customers.name,
        customerCompany: customers.company,
        customerEmail: customers.email,
        customerPhone: customers.phone,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(eq(orders.id, orderId));

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    const ops = await db
      .select({
        id: orderOperations.id,
        stepOrder: orderOperations.stepOrder,
        operationName: orderOperations.operationName,
        estimatedMinutes: orderOperations.estimatedMinutes,
        actualMinutes: orderOperations.actualMinutes,
        status: orderOperations.status,
        machineId: orderOperations.machineId,
        machineName: machines.name,
        machineCode: machines.code,
        machineCategory: machines.category,
        operatorId: orderOperations.operatorId,
        operatorName: users.name,
        operatorAvatar: users.avatarColor,
        startTime: orderOperations.startTime,
        endTime: orderOperations.endTime,
        scheduledStart: orderOperations.scheduledStart,
        scheduledEnd: orderOperations.scheduledEnd,
        qualityNotes: orderOperations.qualityNotes,
        rejectReason: orderOperations.rejectReason,
      })
      .from(orderOperations)
      .leftJoin(machines, eq(orderOperations.machineId, machines.id))
      .leftJoin(users, eq(orderOperations.operatorId, users.id))
      .where(eq(orderOperations.orderId, orderId))
      .orderBy(asc(orderOperations.stepOrder));

    const mats = await db
      .select({
        id: orderMaterials.id,
        itemId: orderMaterials.itemId,
        itemName: inventoryItems.name,
        itemSku: inventoryItems.sku,
        itemUnit: inventoryItems.unit,
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

    // Total cost of materials (active allocations only)
    const materialsTotalCost = mats
      .filter((m) => !m.released)
      .reduce((s, m) => s + Number(m.costPerUnit || 0) * m.quantityUsed, 0);

    // Field-level redaction for floor roles (Machine Operator, QA & Dispatch,
    // Technician): hide order quote value + material costs.
    const isFloor = isFloorRole(user);

    return NextResponse.json({
      ...order,
      totalValue: isFloor ? null : order.totalValue,
      operations: ops,
      materials: isFloor ? mats.map(m => ({ ...m, costPerUnit: null })) : mats,
      materialsTotalCost: isFloor ? null : materialsTotalCost.toFixed(2),
    });
  } catch (error: any) {
    console.error("GET order details error:", error);
    return NextResponse.json({ error: error?.message || "Failed to fetch order details" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error: authError } = await authorize("orders:edit");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await context.params;
    const orderId = Number(id);
    const body = await request.json();

    // Sales can only edit orders they own
    if (user.role === "Sales Coordinator") {
      const [owned] = await db
        .select({ createdById: orders.createdById, assignedSalesId: orders.assignedSalesId })
        .from(orders)
        .where(eq(orders.id, orderId));
      if (!owned) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }
      if (owned.createdById !== user.id && owned.assignedSalesId !== user.id) {
        return NextResponse.json(
          { error: "You can only edit orders assigned to you." },
          { status: 403 },
        );
      }
    }

    const updateFields: any = {};
    if (body.title !== undefined) updateFields.title = body.title;
    if (body.projectType !== undefined) updateFields.projectType = body.projectType;
    if (body.priority !== undefined) updateFields.priority = body.priority;
    if (body.totalValue !== undefined) updateFields.totalValue = String(body.totalValue);
    if (body.dueDate !== undefined) updateFields.dueDate = new Date(body.dueDate);
    if (body.progressPercent !== undefined) updateFields.progressPercent = Number(body.progressPercent);
    if (body.notes !== undefined) updateFields.notes = body.notes;
    if (body.materialsStatus !== undefined) updateFields.materialsStatus = body.materialsStatus;

    // If the caller is trying to mark the order as Completed, run the
    // material-consumption flow first (in the same transaction).
    if (body.status === "Completed") {
      const { consumeMaterialsForOrder } = await import("@/lib/materials");
      await consumeMaterialsForOrder(orderId, user.id, {
        notes: "Order marked Completed",
      });
    }

    // If the order is being put On Hold or some other inactive state,
    // release any still-active reservations so other orders can use them.
    if (body.status === "On Hold" || body.status === "Cancelled") {
      const { releaseMaterialsForOrder } = await import("@/lib/materials");
      await releaseMaterialsForOrder(orderId);
    }

    // Note: regular status changes (not Completed) don't go through the
    // material flow - we still set status if provided.
    if (body.status !== undefined && body.status !== "Completed" && body.status !== "On Hold" && body.status !== "Cancelled") {
      updateFields.status = body.status;
    } else if (body.status !== undefined) {
      // Pass it through; the material helper doesn't change status itself
      updateFields.status = body.status;
    }

    const [updatedOrder] = await db
      .update(orders)
      .set(updateFields)
      .where(eq(orders.id, orderId))
      .returning();

    return NextResponse.json(updatedOrder);
  } catch (error: any) {
    console.error("PATCH order error:", error);
    return NextResponse.json({ error: error?.message || "Failed to update order" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("orders:delete");
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const orderId = Number(id);

    // Policy: block deletion if any material has been consumed on this order
    // (locked setting: "Block delete if any material consumed").
    const consumedRows = await db
      .select({ count: sql<number>`count(*)` })
      .from(materialConsumptions)
      .where(eq(materialConsumptions.orderId, orderId));
    const consumedCount = Number(consumedRows[0]?.count ?? 0);
    if (consumedCount > 0) {
      return NextResponse.json(
        {
          error:
            "Cannot delete this order: " +
            consumedCount +
            " material consumption record(s) exist on it. Deleting is blocked by the stock rollback policy — " +
            "mark the order On Hold instead if it should not proceed.",
        },
        { status: 409 },
      );
    }

    // Delete related records first due to constraints
    await db.delete(orderMaterials).where(eq(orderMaterials.orderId, orderId));
    await db.delete(orderOperations).where(eq(orderOperations.orderId, orderId));
    await db.delete(orders).where(eq(orders.id, orderId));

    return NextResponse.json({ success: true, message: "Order and workflow operations deleted." });
  } catch (error: any) {
    console.error("DELETE order error:", error);
    return NextResponse.json({ error: error?.message || "Failed to delete order" }, { status: 500 });
  }
}
