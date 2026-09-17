import { NextResponse } from "next/server";
import { db } from "@/db";
import { orderOperations, orders, machines, users, orderMaterials, inventoryItems } from "@/db/schema";
import { eq, asc, desc, not, inArray } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { readAllProgress } from "@/lib/materialProgress.server";
import { readAllRoutes } from "@/lib/materialRoutes.server";
import { routeStageKeys } from "@/lib/productionPlan";
import { readOrderProductionPlan, readProductionPlanStore } from "@/lib/productionPlan.server";

export async function GET(request: Request) {
  const { error: authError } = await authorize("orders:read");
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const machineId = url.searchParams.get("machineId");
    const status = url.searchParams.get("status");
    const activeOnly = url.searchParams.get("activeOnly") === "true";

    const allOps = await db
      .select({
        id: orderOperations.id,
        orderId: orderOperations.orderId,
        stepOrder: orderOperations.stepOrder,
        operationName: orderOperations.operationName,
        estimatedMinutes: orderOperations.estimatedMinutes,
        actualMinutes: orderOperations.actualMinutes,
        status: orderOperations.status,
        startTime: orderOperations.startTime,
        endTime: orderOperations.endTime,
        scheduledStart: orderOperations.scheduledStart,
        scheduledEnd: orderOperations.scheduledEnd,
        qualityNotes: orderOperations.qualityNotes,
        machineId: orderOperations.machineId,
        machineName: machines.name,
        machineCode: machines.code,
        machineCategory: machines.category,
        operatorId: orderOperations.operatorId,
        operatorName: users.name,
        operatorAvatar: users.avatarColor,
        orderNumber: orders.orderNumber,
        orderTitle: orders.title,
        orderPriority: orders.priority,
      })
      .from(orderOperations)
      .leftJoin(machines, eq(orderOperations.machineId, machines.id))
      .leftJoin(users, eq(orderOperations.operatorId, users.id))
      .leftJoin(orders, eq(orderOperations.orderId, orders.id))
      .orderBy(asc(orderOperations.stepOrder));

    let filtered = allOps;
    if (machineId) {
      filtered = filtered.filter(o => String(o.machineId) === String(machineId));
    }
    if (status && status !== "All") {
      filtered = filtered.filter(o => o.status.toLowerCase() === status.toLowerCase());
    }
    if (activeOnly) {
      filtered = filtered.filter(o => o.status === "Ready" || o.status === "In Progress" || o.status === "Rejected/Rework");
    }

    // Attach the order's materials with their live production stage so the
    // operator station can show the process per material ("cutting by material").
    const orderIds = Array.from(new Set(filtered.map((o) => o.orderId).filter((id): id is number => typeof id === "number")));
    const stepsByOrder = new Map<number, string[]>();
    for (const o of allOps) {
      const list = stepsByOrder.get(o.orderId) ?? [];
      if (!list.includes(o.operationName)) list.push(o.operationName);
      stepsByOrder.set(o.orderId, list);
    }

    const planStore = readProductionPlanStore();
    const operationBindings = new Map<number, { item: any; step: any }>();
    for (const plan of Object.values(planStore.orders)) {
      if (!orderIds.includes(plan.orderId)) continue;
      for (const item of plan.items) {
        for (const step of item.steps) operationBindings.set(step.operationId, { item, step });
      }
    }
    let materialsByOrder = new Map<number, any[]>();
    if (orderIds.length > 0) {
      const [mats, progress, allRoutes] = await Promise.all([
        db
          .select({
            id: orderMaterials.id,
            orderId: orderMaterials.orderId,
            itemName: inventoryItems.name,
            itemSku: inventoryItems.sku,
            itemUnit: inventoryItems.unit,
            quantityUsed: orderMaterials.quantityUsed,
          })
          .from(orderMaterials)
          .leftJoin(inventoryItems, eq(orderMaterials.itemId, inventoryItems.id))
          .where(inArray(orderMaterials.orderId, orderIds)),
        Promise.resolve(readAllProgress()),
        Promise.resolve(readAllRoutes()),
      ]);
      const routes = allRoutes;
      const plannedMaterials = new Map<number, any>();
      for (const plan of Object.values(planStore.orders)) {
        for (const item of plan.items) plannedMaterials.set(item.materialId, item);
      }
      for (const m of mats) {
        const list = materialsByOrder.get(m.orderId) ?? [];
        const p = progress[String(m.id)];
        const planned = plannedMaterials.get(m.id);
        list.push({
          ...m,
          stage: p?.stage ?? "",
          stageAt: p?.at ?? "",
          stageBy: p?.by ?? "",
          route: planned ? routeStageKeys(planned) : (routes[String(m.id)] ?? null),
          productionItemName: planned?.name ?? null,
        });
        materialsByOrder.set(m.orderId, list);
      }
    }
    return NextResponse.json(filtered.map((o) => {
      const binding = operationBindings.get(o.id);
      const allMaterials = materialsByOrder.get(o.orderId) ?? [];
      if (!binding) {
        return { ...o, materials: allMaterials, orderSteps: stepsByOrder.get(o.orderId) ?? [] };
      }
      return {
        ...o,
        machineCategory: o.machineCategory || binding.step.machineCategory,
        materials: allMaterials.filter((material: any) => material.id === binding.item.materialId),
        orderSteps: routeStageKeys(binding.item),
        productionItem: {
          materialId: binding.item.materialId,
          name: binding.item.name,
          recipeName: binding.item.recipeName,
          routeSource: binding.item.routeSource,
          routePosition: binding.step.position,
          routeLength: binding.item.steps.length,
          steps: binding.item.steps,
        },
      };
    }));
  } catch (error: any) {
    console.error("GET operations error:", error);
    return NextResponse.json({ error: error?.message || "Failed to fetch shop floor operations" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // Adding a step is a planning task - Manager only.
  const { error: authError } = await authorize("operations:create");
  if (authError) return authError;

  try {
    const body = await request.json();
    const { orderId, machineId, operationName, estimatedMinutes = 60, operatorId } = body;

    if (!orderId || !operationName) {
      return NextResponse.json({ error: "Order ID and Operation Name are required" }, { status: 400 });
    }

    if (readOrderProductionPlan(Number(orderId))) {
      return NextResponse.json(
        { error: "Add or change passes through the material production plan, not as a loose order step." },
        { status: 409 },
      );
    }

    const existingOps = await db.select().from(orderOperations).where(eq(orderOperations.orderId, Number(orderId))).orderBy(asc(orderOperations.stepOrder));
    const stepOrder = existingOps.length > 0 ? existingOps[existingOps.length - 1].stepOrder + 1 : 1;
    
    // Check if previous step is completed or if it's step 1
    let initialStatus = "Pending";
    if (existingOps.length === 0 || existingOps[existingOps.length - 1].status === "Completed") {
      initialStatus = "Ready";
    }

    const [newOp] = await db.insert(orderOperations).values({
      orderId: Number(orderId),
      machineId: machineId ? Number(machineId) : null,
      stepOrder,
      operationName,
      estimatedMinutes: Number(estimatedMinutes),
      status: initialStatus,
      operatorId: operatorId ? Number(operatorId) : null,
    }).returning();

    return NextResponse.json(newOp, { status: 201 });
  } catch (error: any) {
    console.error("POST operations error:", error);
    return NextResponse.json({ error: error?.message || "Failed to add step" }, { status: 500 });
  }
}
