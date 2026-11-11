// ============================================================================
// Warehouse board.
//   GET  — every open order with its BOM lines, fulfilment status and the
//          machines of its operations (for "send to machine").
//   PUT  — move a BOM line through Requested -> Prepared -> Delivered.
// Requires: GET orders:read; PUT inventory:write OR orders:write.
// ============================================================================

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
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
import { readBomBoardState, readBomStatus, receiptLotsForAllocation, setBomStatus, setOrderReceived, setReceiptLot, withReceiptAllocationLock, type BomReceiptLot, type BomStatus, type ReceptionState } from "@/lib/bomStatus.server";
import { logAudit } from "@/lib/audit.server";
import { findProductionItemByMaterial, MAX_PRODUCTION_ITEMS, MAX_PRODUCTION_STEPS, productionStageKey, type PlannedProductionItem } from "@/lib/productionPlan";
import { readOrderProductionPlan, readProductionPlanStore } from "@/lib/productionPlan.server";
import { operationMachineCandidates } from "@/lib/operationMachineCandidates.server";
import { applyBomQuantityAction, preparedQty as linePreparedQty, sentQty as lineSentQty } from "@/lib/bomDelivery";
import { acceptedReceiptQuantity, availableReceiptQuantity, receiptQuantityFitsShipment } from "@/lib/receiptLots";

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

    const bomState = readBomBoardState();
    const overlay = bomState.entries;
    const receivedMap = bomState.received;
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
        receivedQuantity: 0,
        requestedQuantity: 0,
      });
    }
    for (const m of mats) {
      const order = byOrder.get(m.orderId);
      if (!order) continue;
      const entry = overlay[String(m.id)];
      const planned = plannedMaterials.get(m.id);
      const receiptLots = bomState.receiptLots[String(m.id)] ?? [];
      const receivedQty = acceptedReceiptQuantity(receiptLots);
      order.receivedQuantity += receivedQty;
      order.requestedQuantity += Number(m.quantityUsed || 0);
      order.materials.push({
        ...m,
        receiptLots,
        receivedQty,
        productionItemName: planned?.name ?? null,
        productionRecipeName: planned?.recipeName ?? null,
        status: entry?.status ?? "Requested",
        machineId: entry?.machineId ?? planned?.steps?.[0]?.machineId ?? null,
        preparedQty: linePreparedQty({ status: entry?.status ?? "Requested", quantityUsed: m.quantityUsed, preparedQty: entry?.preparedQty, deliveredQty: entry?.deliveredQty }),
        deliveredQty: lineSentQty({ status: entry?.status ?? "Requested", quantityUsed: m.quantityUsed, deliveredQty: entry?.deliveredQty }),
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
        receiptLotId: planned?.item.receiptLotId ?? null,
        lotNumber: planned?.item.lotNumber ?? null,
        quantity: planned?.item.quantityUsed ?? null,
        candidates,
        // Effective candidate offer (pending/ready only): lets the reception
        // board show multi-station offers and the claimed machine afterwards.
        candidateMachineIds: operationMachineCandidates(op.id, op.machineId, op.status),
      });
    }
    const operationById = new Map(ops.map((operation) => [operation.id, operation]));
    for (const order of byOrder.values()) {
      order.operations.sort((a: any, b: any) => a.stepOrder - b.stepOrder);
      const progress = new Map<string, any>();
      const plan = planStore.orders[String(order.id)];
      const countedDemand = new Set<string>();
      for (const item of plan?.items ?? []) {
        if (!item.receiptLotId) continue;
        const lotQty = item.quantityUsed;
        for (let stepIndex = 0; stepIndex < item.steps.length; stepIndex++) {
          const step = item.steps[stepIndex];
          const key = `${step.position}:${step.operationName}`;
          const entry = progress.get(key) ?? { position: step.position, operationName: step.operationName, receivedQuantity: 0, atQuantity: 0, inProgressQuantity: 0, completedQuantity: 0, requestedQuantity: 0 };
          entry.receivedQuantity += lotQty;
          const operation = operationById.get(step.operationId);
          const predecessor = stepIndex > 0 ? operationById.get(item.steps[stepIndex - 1].operationId) : null;
          if (operation?.status === "Completed") entry.completedQuantity += lotQty;
          else if (stepIndex === 0 || predecessor?.status === "Completed") entry.atQuantity += lotQty;
          if (operation?.status === "In Progress" || operation?.status === "Paused") entry.inProgressQuantity += lotQty;
          if (!countedDemand.has(`${item.materialId}:${key}`)) {
            const source = mats.find((material) => material.id === item.materialId);
            entry.requestedQuantity += Number(source?.quantityUsed || 0);
            countedDemand.add(`${item.materialId}:${key}`);
          }
          progress.set(key, entry);
        }
      }
      order.operationProgress = Array.from(progress.values()).sort((a, b) => a.position - b.position);
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

    // Partial receipt: one accepted quantity creates one independent production lot.
    if (body.allocationId != null && body.state === "Received" && body.quantity != null) {
      const isReceiver = can(user.role, "bom:receive") || user.displayRole === "Floor Supervisor";
      if (!isReceiver) {
        return NextResponse.json({ error: "Only the Floor Supervisor can approve or decline material reception." }, { status: 403 });
      }
      const allocationId = Number(body.allocationId);
      const quantity = Number(body.quantity);
      if (!Number.isInteger(allocationId) || allocationId <= 0 || !Number.isInteger(quantity) || quantity <= 0) {
        return NextResponse.json({ error: "Choose a positive whole quantity for this receipt." }, { status: 400 });
      }
      return await withReceiptAllocationLock(allocationId, async () => {
        const [line] = await db.select({ id: orderMaterials.id, orderId: orderMaterials.orderId, itemId: orderMaterials.itemId, quantityUsed: orderMaterials.quantityUsed, itemName: inventoryItems.name })
          .from(orderMaterials).leftJoin(inventoryItems, eq(orderMaterials.itemId, inventoryItems.id)).where(eq(orderMaterials.id, allocationId));
        if (!line) return NextResponse.json({ error: "This material allocation no longer exists." }, { status: 404 });
        const sent = lineSentQty({
          status: readBomStatus().entries[String(allocationId)]?.status ?? "Requested",
          quantityUsed: line.quantityUsed,
          deliveredQty: readBomStatus().entries[String(allocationId)]?.deliveredQty,
        });
        const lots = receiptLotsForAllocation(allocationId);
        const previouslyAccepted = acceptedReceiptQuantity(lots);
        const availableToAccept = availableReceiptQuantity(sent, lots);
        if (!receiptQuantityFitsShipment(quantity, sent, lots)) {
          return NextResponse.json({ error: `Only ${availableToAccept} sent unit(s) remain available to accept. Reconcile the shipment discrepancy before accepting more.` }, { status: 409 });
        }
        let plan = readOrderProductionPlan(line.orderId);
        let sourceItem = plan?.items.find((item) => item.materialId === allocationId);
        const synthesizedSourceItem = !sourceItem;
        if (!sourceItem) {
          const operationRows = await db.select({
            id: orderOperations.id,
            operationName: orderOperations.operationName,
            machineId: orderOperations.machineId,
            machineCategory: machines.category,
            estimatedMinutes: orderOperations.estimatedMinutes,
          }).from(orderOperations).leftJoin(machines, eq(orderOperations.machineId, machines.id))
            .where(eq(orderOperations.orderId, line.orderId)).orderBy(asc(orderOperations.stepOrder));
          const defaultRoute = (plan?.defaultSteps ?? []).slice(0, MAX_PRODUCTION_STEPS).map((step, index) => ({
            ...step,
            operationId: index + 1,
            position: index + 1,
            stageKey: productionStageKey(index + 1, step.operationName),
          }));
          const alreadyPlannedOperationIds = new Set(plan?.items.flatMap((item) => item.steps.map((step) => step.operationId)) ?? []);
          const route = defaultRoute.length > 0 ? defaultRoute : operationRows
            .filter((operation) => !alreadyPlannedOperationIds.has(operation.id))
            .slice(0, MAX_PRODUCTION_STEPS)
            .map((operation, index) => {
              const operationName = operation.operationName.trim();
              const machineCategory = operation.machineCategory || "General";
              return operationName && machineCategory ? {
                operationId: operation.id,
                position: index + 1,
                stageKey: productionStageKey(index + 1, operationName),
                operationName,
                machineCategory,
                estimatedMinutes: Math.max(1, Number(operation.estimatedMinutes) || 60),
                auto: !operation.machineId,
                machineId: operation.machineId,
              } : null;
            }).filter((step): step is NonNullable<typeof step> => Boolean(step));
          if (!line.itemName || route.length === 0) {
            return NextResponse.json({ error: "This material has no usable operation route. Add production steps before accepting it." }, { status: 409 });
          }
          sourceItem = {
            materialId: allocationId,
            itemId: line.itemId,
            name: line.itemName,
            quantityUsed: line.quantityUsed,
            routeSource: "default",
            recipeId: null,
            recipeName: "",
            steps: route,
          };
          plan = plan ?? { receiptTracking: true, orderId: line.orderId, createdAt: new Date().toISOString(), defaultSteps: [], items: [] };
        }
        if (!plan || !sourceItem) {
          return NextResponse.json({ error: "This material has no independent production route to release." }, { status: 409 });
        }
        if (plan.items.length >= MAX_PRODUCTION_ITEMS) {
          return NextResponse.json({ error: "This order has reached the maximum number of independent production lots." }, { status: 409 });
        }

        const lotId = `r-${allocationId}-${Date.now()}-${randomUUID()}`;
        const lotNumber = lots.length + 1;
        const createdAt = new Date().toISOString();
        const usedSourceChain = !synthesizedSourceItem && !sourceItem.receiptLotId;
        let lotItem: PlannedProductionItem;
        if (usedSourceChain) {
          lotItem = { ...sourceItem, receiptLotId: lotId, lotNumber, quantityUsed: quantity };
        } else {
          const maxOrderStep = await db.select({ stepOrder: orderOperations.stepOrder }).from(orderOperations).where(eq(orderOperations.orderId, line.orderId));
          let stepOrder = maxOrderStep.reduce((max, row) => Math.max(max, row.stepOrder), 0) + 1;
          const newSteps: PlannedProductionItem["steps"] = [];
          await db.transaction(async (tx) => {
            for (let index = 0; index < sourceItem.steps.length; index++) {
              const step = sourceItem.steps[index];
              const [created] = await tx.insert(orderOperations).values({
                orderId: line.orderId,
                machineId: step.machineId,
                stepOrder: stepOrder++,
                operationName: step.operationName,
                estimatedMinutes: step.estimatedMinutes,
                status: index === 0 ? "Ready" : "Pending",
              }).returning({ id: orderOperations.id });
              newSteps.push({ ...step, operationId: created.id });
            }
          });
          lotItem = { ...sourceItem, receiptLotId: lotId, lotNumber, quantityUsed: quantity, steps: newSteps };
        }
        const updatedPlan = {
          ...plan,
          receiptTracking: true,
          items: usedSourceChain
            ? plan.items.map((item) => item === sourceItem ? lotItem : item)
            : [...plan.items, lotItem],
        };
        const { saveOrderProductionPlan } = await import("@/lib/productionPlan.server");
        saveOrderProductionPlan(updatedPlan);
        const lot: BomReceiptLot = { id: lotId, allocationId, quantity, at: createdAt };
        setReceiptLot(allocationId, lot);
        const orderLines = await db.select({ id: orderMaterials.id, quantityUsed: orderMaterials.quantityUsed }).from(orderMaterials).where(eq(orderMaterials.orderId, line.orderId));
        const totalRequested = orderLines.reduce((sum, row) => sum + Number(row.quantityUsed || 0), 0);
        const totalAccepted = orderLines.reduce((sum, row) => sum + acceptedReceiptQuantity(receiptLotsForAllocation(row.id)), 0);
        const fullyReceived = totalRequested > 0 && totalAccepted >= totalRequested;
        setOrderReceived(line.orderId, fullyReceived, fullyReceived ? "Received" : "Not Received");
        logAudit(user, "bom.reception.approve", "order", `Accepted receipt lot ${lotNumber} · ${quantity} unit(s)`, line.orderId);
        return NextResponse.json({ ok: true, orderId: line.orderId, allocationId, lot, receivedQty: previouslyAccepted + quantity, requestedQty: line.quantityUsed, fullyReceived });
      });
    }

    // Legacy order-level decision — retained for existing orders without receipt lots.
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
    const action = body.action === "prepare" || body.action === "send" ? body.action : null;
    const requestedStatus = body.status == null ? null : String(body.status) as BomStatus;
    if (!Number.isInteger(allocationId) || (!action && (!requestedStatus || !VALID.includes(requestedStatus)))) {
      return NextResponse.json({ error: "allocationId and a valid warehouse action or status are required." }, { status: 400 });
    }
    return await withReceiptAllocationLock(allocationId, async () => {
      const [line] = await db
        .select({ id: orderMaterials.id, orderId: orderMaterials.orderId, itemId: orderMaterials.itemId, quantityUsed: orderMaterials.quantityUsed })
        .from(orderMaterials)
        .where(eq(orderMaterials.id, allocationId));
      if (!line) {
        return NextResponse.json({ error: "This material allocation no longer exists." }, { status: 404 });
      }
      const existing = readBomStatus().entries[String(allocationId)];
      const totalQty = Math.max(0, Math.floor(Number(line.quantityUsed) || 0));
      const previousLine = {
        status: existing?.status ?? "Requested",
        quantityUsed: totalQty,
        preparedQty: existing?.preparedQty,
        deliveredQty: existing?.deliveredQty,
      } as const;
      const prevPrepared = linePreparedQty(previousLine);
      const prevSent = lineSentQty(previousLine);
      let prepared = prevPrepared;
      let sent = prevSent;
      let auditAction = "bom.update";

      if (action) {
        if (!Number.isInteger(Number(body.quantity)) || Number(body.quantity) <= 0) {
          return NextResponse.json({ error: "Enter a positive whole quantity." }, { status: 400 });
        }
        const result = applyBomQuantityAction(previousLine, action, body.quantity);
        if (!result.ok) {
          return NextResponse.json({ error: result.error }, { status: 409 });
        }
        prepared = result.preparedQty;
        sent = result.deliveredQty;
        auditAction = action === "prepare" ? "bom.prepare.partial" : "bom.send.partial";
      } else if (requestedStatus === "Requested") {
        prepared = 0;
        sent = 0;
        auditAction = "bom.reset";
      } else if (requestedStatus === "Delivered") {
        if (prevPrepared < totalQty) {
          return NextResponse.json(
            { error: `Prepare all ${totalQty} unit(s) before sending the remaining material.` },
            { status: 409 },
          );
        }
        prepared = prevPrepared;
        sent = totalQty;
        auditAction = "bom.deliver";
      } else if (requestedStatus === "Prepared") {
        // Backward-compatible full Prepare button. Re-saving the same status for
        // a machine assignment preserves any partial counts already recorded.
        if (existing?.status !== "Prepared" && body.deliverQty == null && body.preparedQty == null) prepared = totalQty;
        if (body.preparedQty != null && body.preparedQty !== "") {
          prepared = Math.max(0, Math.min(totalQty, Math.floor(Number(body.preparedQty) || 0)));
        }
        if (body.deliverQty != null && body.deliverQty !== "") {
          sent = Math.max(0, Math.min(totalQty, Math.floor(Number(body.deliverQty) || 0)));
          if (existing?.preparedQty == null && existing?.status === "Prepared") prepared = totalQty;
        }
        auditAction = sent > prevSent ? "bom.send" : prepared > prevPrepared ? "bom.prepare" : "bom.update";
      }

      if (sent > prepared) {
        return NextResponse.json({ error: "Material cannot be sent before it is prepared." }, { status: 409 });
      }
      const acceptedQty = acceptedReceiptQuantity(receiptLotsForAllocation(allocationId));
      if (sent < acceptedQty) {
        return NextResponse.json({ error: `Cannot reduce the sent quantity below ${acceptedQty} already accepted unit(s). Reconcile the receipt before changing warehouse delivery.` }, { status: 409 });
      }
      const status: BomStatus = totalQty > 0 && sent >= totalQty
        ? "Delivered"
        : prepared > 0 ? "Prepared" : "Requested";
      const deliveredQty = sent > 0 ? sent : null;
      const preparedQty = prepared > 0 ? prepared : null;
      // Only a Manager may change the target machine; everyone else keeps the
      // machine the routing assigned (or the last manager-chosen one). A v2 line
      // always follows the first pass of its linked production chain.
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
      setBomStatus(allocationId, status, machineId, deliveredQty, preparedQty);
      logAudit(user, auditAction, "bom_line", `Warehouse ${action ?? status.toLowerCase()} · prepared ${prepared}/${totalQty} · sent ${sent}/${totalQty}`, allocationId);

      // Sending material to the floor is when stock is actually consumed (not
      // when the order is marked Completed); undoing a send restores it.
      const newSent = sent;
      let sendWarning: string | undefined;
      if (newSent !== prevSent) {
        const { applyBomSendDelta } = await import("@/lib/materials");
        const result = await applyBomSendDelta({
          orderId: line.orderId,
          allocationId,
          itemId: line.itemId,
          quantityUsed: line.quantityUsed,
          prevSent,
          newSent,
          consumedBy: user.id,
        });
        if (result.auditError) {
          sendWarning = `Stock updated, but the consumption audit could not be recorded: ${result.auditError}. Fix with Inventory -> Schema Check -> Add Missing Columns.`;
        }
      }

      return NextResponse.json({ ok: true, allocationId, status, machineId, preparedQty, deliveredQty, warning: sendWarning });
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update status";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
