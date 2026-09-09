// ============================================================================
// Warehouse & BOM board.
//   GET  — every open order with its BOM lines, fulfilment status and the
//          machines of its operations (for "send to machine").
//   PUT  — move a BOM line through Requested -> Prepared -> Delivered.
// Requires: GET orders:read; PUT inventory:write OR orders:write.
// ============================================================================

import { NextResponse } from "next/server";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  inventoryItems,
  machines,
  orderMaterials,
  orderOperations,
  orders,
  customers,
} from "@/db/schema";
import { authorize, getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { readBomStatus, setBomStatus, type BomStatus } from "@/lib/bomStatus.server";

const VALID: BomStatus[] = ["Requested", "Prepared", "Delivered"];

export async function GET() {
  const { error } = await authorize("orders:read");
  if (error) return error;
  try {
    const openOrders = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        title: orders.title,
        status: orders.status,
        priority: orders.priority,
        dueDate: orders.dueDate,
        customerCompany: customers.company,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(
        and(
          ne(orders.status, "Completed"),
          ne(orders.status, "On Hold"),
          ne(orders.status, "Cancelled"),
        ),
      )
      .orderBy(asc(orders.dueDate));

    const ids = openOrders.map((o) => o.id);
    if (ids.length === 0) return NextResponse.json({ orders: [] });

    const [mats, ops] = await Promise.all([
      db
        .select({
          id: orderMaterials.id,
          orderId: orderMaterials.orderId,
          itemId: orderMaterials.itemId,
          itemName: inventoryItems.name,
          itemSku: inventoryItems.sku,
          itemUnit: inventoryItems.unit,
          itemCategory: inventoryItems.category,
          stockQuantity: inventoryItems.stockQuantity,
          quantityUsed: orderMaterials.quantityUsed,
          consumed: orderMaterials.consumed,
          released: orderMaterials.released,
        })
        .from(orderMaterials)
        .leftJoin(inventoryItems, eq(orderMaterials.itemId, inventoryItems.id))
        .where(inArray(orderMaterials.orderId, ids)),
      db
        .select({
          orderId: orderOperations.orderId,
          machineId: orderOperations.machineId,
          machineCode: machines.code,
          machineName: machines.name,
        })
        .from(orderOperations)
        .leftJoin(machines, eq(orderOperations.machineId, machines.id))
        .where(inArray(orderOperations.orderId, ids)),
    ]);

    const overlay = readBomStatus().entries;

    const byOrder = new Map<number, any>();
    for (const o of openOrders) {
      byOrder.set(o.id, { ...o, materials: [], machines: [] });
    }
    for (const m of mats) {
      const order = byOrder.get(m.orderId);
      if (!order) continue;
      const entry = overlay[String(m.id)];
      order.materials.push({
        ...m,
        status: entry?.status ?? "Requested",
        machineId: entry?.machineId ?? null,
      });
    }
    const seenMachine = new Map<number, Set<number>>();
    for (const op of ops) {
      if (op.machineId == null) continue;
      const order = byOrder.get(op.orderId);
      if (!order) continue;
      if (!seenMachine.has(op.orderId)) seenMachine.set(op.orderId, new Set());
      const set = seenMachine.get(op.orderId)!;
      if (set.has(op.machineId)) continue;
      set.add(op.machineId);
      order.machines.push({ id: op.machineId, code: op.machineCode, name: op.machineName });
    }

    return NextResponse.json({ orders: Array.from(byOrder.values()) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load the BOM board";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  }
  if (!can(user.role, "inventory:write") && !can(user.role, "orders:write")) {
    return NextResponse.json({ error: "You cannot update material fulfilment." }, { status: 403 });
  }
  try {
    const body = await request.json();
    const allocationId = Number(body.allocationId);
    const status = String(body.status) as BomStatus;
    if (!Number.isInteger(allocationId) || !VALID.includes(status)) {
      return NextResponse.json({ error: "allocationId and a valid status are required." }, { status: 400 });
    }
    const machineId = body.machineId != null && body.machineId !== "" ? Number(body.machineId) : null;
    setBomStatus(allocationId, status, machineId);
    return NextResponse.json({ ok: true, allocationId, status, machineId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
