// ============================================================================
// Dispatch queue — one independent row per orderMaterials material batch.
//
// Rows are created when an order is issued and remain visible while production
// runs. A batch can advance only after its own operation chain is complete.
// Legacy orders without material rows retain the original order-level flow.
// Storage: data/dispatch-status.json (no database migration).
// ============================================================================

import { NextResponse } from "next/server";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { customers, inventoryItems, orderMaterials, orderOperations, orders } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { baseRoleOf, can } from "@/lib/permissions";
import { listOrdersForUser } from "@/lib/dataAccess";
import {
  ALL_STAGES,
  allCurrentBatchesDelivered,
  defaultStage,
  dispatchBatchKey,
  dispatchLegacyOrderKey,
  nextStage,
  type DispatchStage,
} from "@/lib/dispatch";
import { updateDispatchStore, type DispatchEntry } from "@/lib/dispatch.server";
import {
  checklistComplete,
  checklistProgress,
  normalizeChecks,
  templateGates,
} from "@/lib/packingQc";
import {
  readBatchChecksFile,
  readChecksFile,
  readTemplateFile,
} from "@/lib/packingQc.server";
import { readOrderProductionPlan, readProductionPlanStore } from "@/lib/productionPlan.server";

function canWriteDispatch(role: string): boolean {
  return can(role, "quality:write") || can(role, "orders:write") || can(role, "inventory:write");
}

function iso(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

async function batchProductionReady(orderId: number, batchId: number | null, orderStatus: string): Promise<boolean> {
  if (!batchId) return orderStatus === "Completed" || orderStatus === "Delivered";
  const plan = readOrderProductionPlan(orderId);
  const item = plan?.items.find((candidate) => candidate.materialId === batchId);
  if (!item) return orderStatus === "Completed" || orderStatus === "Delivered";
  if (item.steps.length === 0) return false;
  const statuses = await db
    .select({ id: orderOperations.id, status: orderOperations.status })
    .from(orderOperations)
    .where(inArray(orderOperations.id, item.steps.map((step) => step.operationId)));
  const byId = new Map(statuses.map((operation) => [operation.id, operation.status]));
  return item.steps.every((step) => byId.get(step.operationId) === "Completed");
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!can(user.role, "orders:read")) {
    return NextResponse.json({ error: "You cannot view dispatch." }, { status: 403 });
  }

  try {
    // Dispatch and shop-floor supervisors need to see newly issued batches even
    // while an order is still Pending. Other roles retain their normal scoped
    // order ids; this prevents the endpoint from becoming a cross-role bypass.
    const baseRole = baseRoleOf(user.role);
    const seesWholeDispatch = user.role === "Manager"
      || baseRole === "Floor Supervisor"
      || baseRole === "QA & Dispatch";
    const scopedIds = seesWholeDispatch
      ? null
      : (await listOrdersForUser(user)).map((order) => order.id);
    if (scopedIds && scopedIds.length === 0) return NextResponse.json({ orders: [] });

    const orderRows = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        title: orders.title,
        projectType: orders.projectType,
        status: orders.status,
        dueDate: orders.dueDate,
        createdAt: orders.createdAt,
        customerCompany: customers.company,
        customerAddress: customers.address,
        customerPhone: customers.phone,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(scopedIds
        ? and(ne(orders.status, "Cancelled"), inArray(orders.id, scopedIds))
        : ne(orders.status, "Cancelled"))
      .orderBy(asc(orders.dueDate), asc(orders.id));
    if (orderRows.length === 0) return NextResponse.json({ orders: [] });

    const orderIds = orderRows.map((order) => order.id);
    const [materials, operationRows] = await Promise.all([
      db
        .select({
          id: orderMaterials.id,
          orderId: orderMaterials.orderId,
          itemId: orderMaterials.itemId,
          itemName: inventoryItems.name,
          itemSku: inventoryItems.sku,
          itemUnit: inventoryItems.unit,
          quantityUsed: orderMaterials.quantityUsed,
        })
        .from(orderMaterials)
        .leftJoin(inventoryItems, eq(orderMaterials.itemId, inventoryItems.id))
        .where(and(
          inArray(orderMaterials.orderId, orderIds),
          eq(orderMaterials.released, false),
        ))
        .orderBy(asc(orderMaterials.orderId), asc(orderMaterials.id)),
      db
        .select({ id: orderOperations.id, orderId: orderOperations.orderId, status: orderOperations.status })
        .from(orderOperations)
        .where(inArray(orderOperations.orderId, orderIds)),
    ]);

    const materialsByOrder = new Map<number, typeof materials>();
    for (const material of materials) {
      const list = materialsByOrder.get(material.orderId) ?? [];
      list.push(material);
      materialsByOrder.set(material.orderId, list);
    }
    const statusByOperation = new Map(operationRows.map((operation) => [operation.id, operation.status]));
    const planStore = readProductionPlanStore();
    const planItemByMaterial = new Map<number, { item: any; batchNumber: number }>();
    for (const plan of Object.values(planStore.orders)) {
      if (!orderIds.includes(plan.orderId)) continue;
      plan.items.forEach((item, index) => planItemByMaterial.set(item.materialId, { item, batchNumber: index + 1 }));
    }

    // Self-heal legacy and manually added allocations in one locked write. New
    // order creation also initializes these rows immediately; this closes any
    // gap left by an old deployment or a transient filesystem interruption.
    const store = await updateDispatchStore((current) => {
      for (const order of orderRows) {
        const orderMaterialRows = materialsByOrder.get(order.id) ?? [];
        let inherited = current.stages[String(order.id)];
        // Orders intentionally issued without a material/cut-list still reserve
        // one order-level row immediately; it becomes actionable at completion.
        if (orderMaterialRows.length === 0 && !inherited) {
          const createdAt = iso(order.createdAt);
          inherited = {
            stage: order.status === "Delivered" ? "delivered" : defaultStage(order.projectType),
            createdAt,
            updatedAt: createdAt,
            proof: null,
          };
          current.stages[String(order.id)] = inherited;
        }
        for (const material of orderMaterialRows) {
          if (current.batches[String(material.id)]) continue;
          const createdAt = iso(order.createdAt);
          current.batches[String(material.id)] = {
            orderId: order.id,
            stage: inherited?.stage
              ?? (order.status === "Delivered" ? "delivered" : defaultStage(order.projectType)),
            createdAt,
            updatedAt: inherited?.updatedAt ?? createdAt,
            proof: inherited?.proof ?? null,
          };
        }
      }
      return current;
    });

    // Parent status reconciliation is deliberately all-batches-only. It also
    // repairs the rare case where the JSON write succeeded but the subsequent
    // relational status update was interrupted.
    const fullyDeliveredOrderIds = orderRows
      .filter((order) => {
        const ids = (materialsByOrder.get(order.id) ?? []).map((material) => material.id);
        return ids.length > 0
          ? allCurrentBatchesDelivered(ids, store.batches)
          : store.stages[String(order.id)]?.stage === "delivered";
      })
      .map((order) => order.id);
    const deliveryStatusRepairs = orderRows
      .filter((order) => order.status !== "Delivered" && fullyDeliveredOrderIds.includes(order.id))
      .map((order) => order.id);
    if (deliveryStatusRepairs.length > 0) {
      await db.update(orders).set({ status: "Delivered" }).where(inArray(orders.id, deliveryStatusRepairs));
    }
    const fullyDelivered = new Set(fullyDeliveredOrderIds);

    const payload: any[] = [];
    for (const order of orderRows) {
      const orderMaterialsRows = materialsByOrder.get(order.id) ?? [];
      const deliveredCount = orderMaterialsRows.filter(
        (material) => store.batches[String(material.id)]?.stage === "delivered",
      ).length;

      for (let index = 0; index < orderMaterialsRows.length; index += 1) {
        const material = orderMaterialsRows[index];
        const entry = store.batches[String(material.id)];
        const planned = planItemByMaterial.get(material.id);
        const productionReady = planned
          ? planned.item.steps.length > 0
            && planned.item.steps.every((step: any) => statusByOperation.get(step.operationId) === "Completed")
          : order.status === "Completed" || order.status === "Delivered" || fullyDelivered.has(order.id);
        const batchName = planned?.item.name || material.itemName || `Material batch ${index + 1}`;
        payload.push({
          ...order,
          status: fullyDelivered.has(order.id) ? "Delivered" : order.status,
          orderId: order.id,
          batchId: material.id,
          dispatchKey: dispatchBatchKey(material.id),
          batchNumber: planned?.batchNumber ?? index + 1,
          batchName,
          itemId: material.itemId,
          itemName: material.itemName,
          itemSku: material.itemSku,
          itemUnit: material.itemUnit,
          quantityUsed: material.quantityUsed,
          stage: entry?.stage ?? defaultStage(order.projectType),
          proof: entry?.proof ?? null,
          productionReady,
          deliveredBatchCount: deliveredCount,
          totalBatchCount: orderMaterialsRows.length,
          materials: [{ ...material, productionItemName: batchName }],
        });
      }

      // Issued orders without a material row reserve one order-level fallback
      // immediately. Historical orders use the same backward-compatible path.
      if (orderMaterialsRows.length === 0) {
        const legacy = store.stages[String(order.id)];
        payload.push({
          ...order,
          status: fullyDelivered.has(order.id) ? "Delivered" : order.status,
          orderId: order.id,
          batchId: null,
          dispatchKey: dispatchLegacyOrderKey(order.id),
          batchNumber: null,
          batchName: "Order-level slot (no material batch)",
          stage: legacy?.stage ?? (order.status === "Delivered" ? "delivered" : defaultStage(order.projectType)),
          proof: legacy?.proof ?? null,
          productionReady: order.status === "Completed" || order.status === "Delivered" || fullyDelivered.has(order.id),
          deliveredBatchCount: legacy?.stage === "delivered" || fullyDelivered.has(order.id) ? 1 : 0,
          totalBatchCount: 1,
          materials: [],
        });
      }
    }

    payload.sort((a, b) =>
      new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
      || a.orderId - b.orderId
      || Number(a.batchId ?? 0) - Number(b.batchId ?? 0)
    );
    return NextResponse.json({ orders: payload });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load the dispatch queue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!canWriteDispatch(user.role)) {
    return NextResponse.json({ error: "You cannot update dispatch stages." }, { status: 403 });
  }

  try {
    const body = await request.json();
    const orderId = Number(body.orderId);
    const batchId = body.batchId == null ? null : Number(body.batchId);
    const stage = String(body.stage) as DispatchStage;
    if (
      !Number.isInteger(orderId)
      || orderId <= 0
      || (batchId !== null && (!Number.isInteger(batchId) || batchId <= 0))
      || !ALL_STAGES.includes(stage)
    ) {
      return NextResponse.json({ error: "A valid orderId, material batch and stage are required." }, { status: 400 });
    }

    const [order] = await db
      .select({
        id: orders.id,
        status: orders.status,
        projectType: orders.projectType,
        createdAt: orders.createdAt,
        orderNumber: orders.orderNumber,
      })
      .from(orders)
      .where(eq(orders.id, orderId));
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

    const currentMaterials = await db
      .select({ id: orderMaterials.id })
      .from(orderMaterials)
      .where(and(eq(orderMaterials.orderId, orderId), eq(orderMaterials.released, false)))
      .orderBy(asc(orderMaterials.id));
    const currentMaterialIds = currentMaterials.map((material) => material.id);
    if (currentMaterialIds.length > 0 && batchId === null) {
      return NextResponse.json(
        { error: "Choose a material batch. Whole-order delivery is disabled when batches exist." },
        { status: 400 },
      );
    }
    if (batchId !== null && !currentMaterialIds.includes(batchId)) {
      return NextResponse.json({ error: "This material batch is not active on the order." }, { status: 404 });
    }

    const productionReady = await batchProductionReady(orderId, batchId, order.status);
    const template = readTemplateFile();
    const orderChecks = readChecksFile();
    const batchChecks = readBatchChecksFile();
    const now = new Date().toISOString();

    const outcome = await updateDispatchStore((store) => {
      const inherited = store.stages[String(orderId)];
      for (const currentBatchId of currentMaterialIds) {
        if (store.batches[String(currentBatchId)]) continue;
        store.batches[String(currentBatchId)] = {
          orderId,
          stage: inherited?.stage
            ?? (order.status === "Delivered" ? "delivered" : defaultStage(order.projectType)),
          createdAt: iso(order.createdAt),
          updatedAt: inherited?.updatedAt ?? iso(order.createdAt),
          proof: inherited?.proof ?? null,
        };
      }

      const currentEntry: DispatchEntry = batchId !== null
        ? store.batches[String(batchId)]
        : store.stages[String(orderId)] ?? {
            stage: order.status === "Delivered" ? "delivered" : defaultStage(order.projectType),
            createdAt: iso(order.createdAt),
          };
      if (!currentEntry) throw Object.assign(new Error("Dispatch batch is unavailable."), { httpStatus: 404 });
      if (stage !== currentEntry.stage) {
        const expected = nextStage(order.projectType, currentEntry.stage);
        if (stage !== expected) {
          throw Object.assign(
            new Error(expected
              ? `This batch must move to ${expected.replaceAll("_", " ")} next.`
              : "A delivered batch cannot be moved again."),
            { httpStatus: 409 },
          );
        }
        if (!productionReady) {
          throw Object.assign(
            new Error("This material batch is still in production. Finish its own machine route before moving it through Dispatch."),
            { httpStatus: 409 },
          );
        }
      }

      if (currentEntry.stage === "packing" && stage === "awaiting_delivery" && templateGates(template)) {
        const rawChecks = batchId !== null
          ? (batchChecks[String(batchId)] ?? orderChecks[String(orderId)])
          : orderChecks[String(orderId)];
        const checks = normalizeChecks(rawChecks, template.length);
        if (!checklistComplete(checks)) {
          throw Object.assign(
            new Error(`This batch's packing QC checklist is not finished (${checklistProgress(checks)}/${template.length}). Open its QC checklist and tick every item first.`),
            { httpStatus: 409 },
          );
        }
      }

      let proof = currentEntry.proof ?? null;
      if (stage === "delivered" && stage !== currentEntry.stage) {
        const receivedBy = String(body.proof?.receivedBy ?? "").trim().slice(0, 120);
        if (!receivedBy) {
          throw Object.assign(new Error("Enter the name of the person who received this batch."), { httpStatus: 400 });
        }
        proof = {
          receivedBy,
          deliveredAt: now,
          notes: String(body.proof?.notes ?? "").trim().slice(0, 500) || null,
        };
      }

      const entry: DispatchEntry = {
        ...currentEntry,
        ...(batchId !== null ? { orderId } : {}),
        stage,
        updatedAt: now,
        proof,
      };
      if (batchId !== null) store.batches[String(batchId)] = entry;
      else store.stages[String(orderId)] = entry;

      const deliveredCount = batchId !== null
        ? currentMaterialIds.filter((id) => store.batches[String(id)]?.stage === "delivered").length
        : stage === "delivered" ? 1 : 0;
      return {
        proof,
        deliveredCount,
        totalCount: batchId !== null ? currentMaterialIds.length : 1,
        parentDelivered: batchId !== null
          ? allCurrentBatchesDelivered(currentMaterialIds, store.batches)
          : stage === "delivered",
      };
    });

    if (outcome.parentDelivered) {
      await db.update(orders).set({ status: "Delivered" }).where(eq(orders.id, orderId));
    }

    logAudit(
      user,
      stage === "delivered" ? "dispatch.batch.delivered" : "dispatch.batch.stage",
      batchId !== null ? "order_material" : "order",
      `Dispatch batch ${batchId ?? orderId}: ${stage}`
        + `${outcome.proof ? ` (received by ${outcome.proof.receivedBy})` : ""}`
        + ` · ${outcome.deliveredCount}/${outcome.totalCount} delivered`,
      batchId ?? orderId,
    );
    return NextResponse.json({
      ok: true,
      orderId,
      batchId,
      stage,
      deliveredBatchCount: outcome.deliveredCount,
      totalBatchCount: outcome.totalCount,
      parentDelivered: outcome.parentDelivered,
    });
  } catch (error: any) {
    const message = error instanceof Error ? error.message : "Failed to update dispatch stage";
    const status = Number(error?.httpStatus) || 500;
    return NextResponse.json({ error: message }, { status });
  }
}
