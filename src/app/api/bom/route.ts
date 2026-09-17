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
import { logAudit } from "@/lib/audit.server";
import { findProductionItemByMaterial } from "@/lib/productionPlan";
import { readOrderProductionPlan, readProductionPlanStore } from "@/lib/productionPlan.server";

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

    const [mats, ops, machinesAll] = await Promise.all([
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
          id: orderOperations.id,
          orderId: orderOperations.orderId,
          stepOrder: orderOperations.stepOrder,
          operationName: orderOperations.operationName,
          status: orderOperations.status,
          machineId: orderOperations.machineId,
          machineCategory: machines.category,
          machineCode: machines.code,
          machineName: machines.name,
        })
        .from(orderOperations)
        .leftJoin(machines, eq(orderOperations.machineId, machines.id))
        .where(inArray(orderOperations.orderId, ids)),
      db
        .select({
          id: machines.id,
          code: machines.code,
          name: machines.name,
          category: machines.category,
          status: machines.status,
        })
        .from(machines),
    ]);

    const overlay = readBomStatus().entries;
    const receivedMap = readReceived();
    const planStore = readProductionPlanStore();
    const plannedMaterials = new Map<number, any>();
    const plannedOperations = new Map<number, any>();
    for (const plan of Object.values(planStore.orders)) {
      if (!ids.includes(plan.orderId)) continue;
      for (const item of plan.items) {
        plannedMaterials.set(item.materialId, item);
        for (const step of item.steps) plannedOperations.set(step.operationId, { item, step });
      }
    }

    const byOrder = new Map<number, any>();
    for (const o of openOrders) {
      const recEntry = receivedMap[String(o.id)];
      byOrder.set(o.id, {
        ...o,
        materials: [],
        machines: [],
        received: recEntry?.received ?? null,
        receivedState: recEntry?.state ?? (recEntry?.received === true ? "Received" : recEntry?.received === false ? "Not Received" : null),
        operations: [],
      });
    }
    for (const m of mats) {
      const order = byOrder.get(m.orderId);
      if (!order) continue;
      const entry = overlay[String(m.id)];
      const planned = plannedMaterials.get(m.id);
      order.materials.push({
        ...m,
        productionItemName: planned?.name ?? null,
        productionRecipeName: planned?.recipeName ?? null,
        status: entry?.status ?? "Requested",
        machineId: entry?.machineId ?? planned?.steps?.[0]?.machineId ?? null,
        deliveredQty: entry?.deliveredQty ?? null,
      });
    }
    const machineById = new Map<number, (typeof machinesAll)[number]>(machinesAll.map((m) => [m.id, m]));
    for (const op of ops) {
      const order = byOrder.get(op.orderId);
      if (!order) continue;
      const current = op.machineId != null ? machineById.get(op.machineId) : undefined;
      const planned = plannedOperations.get(op.id);
      const requiredCategory = planned?.step.machineCategory || current?.category || null;
      // Never offer a wrong machine type for a planned material pass.
      const candidates = machinesAll
        .filter((machine) =>
          (!requiredCategory || machine.category.toLowerCase() === String(requiredCategory).toLowerCase()) &&
          (machine.status === "Active" || machine.status === "In-Use")
        )
        .map((machine) => ({ id: machine.id, code: machine.code, name: machine.name, status: machine.status }));
      order.operations.push({
        id: op.id,
        stepOrder: op.stepOrder,
        operationName: op.operationName,
        status: op.status,
        machineId: op.machineId,
        machineCode: op.machineCode,
        machineCategory: requiredCategory,
        productionItemName: planned?.item.name ?? null,
        candidates,
      });
    }
    for (const o of byOrder.values()) {
      o.operations.sort((a: any, b: any) => a.stepOrder - b.stepOrder);
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
      logAudit(user, `bom.reception.${state === "Received" ? "approve" : state === "Declined" ? "decline" : "flag"}`, "order", `Material reception: ${state}`, orderId);
      return NextResponse.json({ ok: true, orderId, received: state === "Received", state });
    }

    const allocationId = Number(body.allocationId);
    const status = String(body.status) as BomStatus;
    if (!Number.isInteger(allocationId) || !VALID.includes(status)) {
      return NextResponse.json({ error: "allocationId and a valid status are required." }, { status: 400 });
    }
    // Partial delivery: how many units have physically gone to the floor.
    // "Delivered" always means the full line quantity; a smaller deliverQty
    // keeps the line in "Prepared" with a tally. Undo to Requested clears it.
    let deliveredQty: number | null = null;
    const [line] = await db
      .select({ id: orderMaterials.id, orderId: orderMaterials.orderId, quantityUsed: orderMaterials.quantityUsed })
      .from(orderMaterials)
      .where(eq(orderMaterials.id, allocationId));
    if (!line) {
      return NextResponse.json({ error: "This material allocation no longer exists." }, { status: 404 });
    }
    if (status === "Delivered") {
      deliveredQty = line.quantityUsed;
    } else if (body.deliverQty != null && body.deliverQty !== "") {
      const n = Math.max(0, Math.min(line.quantityUsed, Math.floor(Number(body.deliverQty) || 0)));
      deliveredQty = n > 0 ? n : null;
    }
    // Only a Manager may change the target machine; everyone else keeps the
    // machine the routing assigned (or the last manager-chosen one). A v2 line
    // always follows the first pass of its linked production chain.
    const existing = readBomStatus().entries[String(allocationId)];
    const mayRoute = can(user.role, "users:manage");
    const wantsMachine = body.machineId != null && body.machineId !== "";
    const plannedItem = findProductionItemByMaterial(readOrderProductionPlan(line.orderId), allocationId);
    const linkedTarget = existing?.machineId ?? plannedItem?.steps?.[0]?.machineId ?? null;
    if (
      wantsMachine &&
      Number(body.machineId) !== Number(linkedTarget) &&
      plannedItem
    ) {
      return NextResponse.json(
        { error: "Change the first production pass assignment; this warehouse destination follows it automatically." },
        { status: 409 },
      );
    }
    const machineId = mayRoute && wantsMachine
      ? Number(body.machineId)
      : linkedTarget;
    setBomStatus(allocationId, status, machineId, deliveredQty);
    logAudit(user, status === "Delivered" ? "bom.deliver" : `bom.${status.toLowerCase()}`, "bom_line", `BOM line -> ${status}${deliveredQty != null && deliveredQty < (line?.quantityUsed ?? 0) ? ` (${deliveredQty}/${line?.quantityUsed} sent)` : ""}`, allocationId);
    return NextResponse.json({ ok: true, allocationId, status, machineId, deliveredQty });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
