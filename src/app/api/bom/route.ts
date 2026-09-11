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
import { readBomStatus, readReceived, setBomStatus, setOrderReceived, type BomStatus, type ReceptionState } from "@/lib/bomStatus.server";

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
          ne(orders.status, "Delivered"),
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
    const receivedMap = readReceived();

    const byOrder = new Map<number, any>();
    for (const o of openOrders) {
      const recEntry = receivedMap[String(o.id)];
      byOrder.set(o.id, {
        ...o,
        materials: [],
        machines: [],
        received: recEntry?.received ?? null,
        receivedState: recEntry?.state ?? (recEntry?.received === true ? "Received" : recEntry?.received === false ? "Not Received" : null),
      });
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

    // Order-level reception decision — Floor Supervisor (or Manager) only.
    // Operators see the BOM read-only; starting work is gated on "Received".
    if (body.orderId != null && (typeof body.received === "boolean" || typeof body.state === "string")) {
      const isReceiver = can(user.role, "bom:receive") || user.displayRole === "Floor Supervisor";
      if (!isReceiver) {
        return NextResponse.json({ error: "Only the Floor Supervisor can approve or decline material reception." }, { status: 403 });
      }
      const orderId = Number(body.orderId);
      if (!Number.isInteger(orderId) || orderId <= 0) {
        return NextResponse.json({ error: "A valid orderId is required." }, { status: 400 });
      }
      const state: ReceptionState =
        body.state === "Received" || body.state === "Not Received" || body.state === "Declined"
          ? body.state
          : body.received === true ? "Received" : "Not Received";
      if (state === "Received") {
        // Approval requires the warehouse to have prepared AND sent every
        // requested line (Requested -> Prepared -> Delivered).
        const lines = await db
          .select({ id: orderMaterials.id })
          .from(orderMaterials)
          .where(eq(orderMaterials.orderId, orderId));
        const entries = readBomStatus().entries;
        const pending = lines.filter((l) => (entries[String(l.id)]?.status ?? "Requested") !== "Delivered");
        if (pending.length > 0) {
          return NextResponse.json({
            error: `Warehouse has not sent all requested materials yet — ${pending.length} line(s) still not Delivered. Reception can only be approved after the warehouse prepares and sends everything.`,
          }, { status: 409 });
        }
      }
      setOrderReceived(orderId, state === "Received", state);
      return NextResponse.json({ ok: true, orderId, received: state === "Received", state });
    }

    const allocationId = Number(body.allocationId);
    const status = String(body.status) as BomStatus;
    if (!Number.isInteger(allocationId) || !VALID.includes(status)) {
      return NextResponse.json({ error: "allocationId and a valid status are required." }, { status: 400 });
    }
    // Only a Manager may change the target machine; everyone else keeps the
    // machine the routing assigned (or the last manager-chosen one).
    const existing = readBomStatus().entries[String(allocationId)];
    const mayRoute = can(user.role, "users:manage");
    const wantsMachine = body.machineId != null && body.machineId !== "";
    const machineId = mayRoute && wantsMachine
      ? Number(body.machineId)
      : (existing?.machineId ?? null);
    setBomStatus(allocationId, status, machineId);
    return NextResponse.json({ ok: true, allocationId, status, machineId });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
