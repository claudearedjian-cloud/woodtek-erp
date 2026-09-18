import { NextResponse } from "next/server";
import { db } from "@/db";
import { orderOperations, orderMaterials, inventoryItems } from "@/db/schema";
import { eq, asc, inArray } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { readBomBoardState } from "@/lib/bomStatus.server";
import {
  listClaimedElsewhereOperationsForUser,
  listMachinesForUser,
  listOperationsForUser,
} from "@/lib/dataAccess";
import { baseRoleOf } from "@/lib/permissions";
import { operationMachineCandidates } from "@/lib/operationMachineCandidates.server";
import { readAllProgress } from "@/lib/materialProgress.server";
import { readAllRoutes } from "@/lib/materialRoutes.server";
import { routeStageKeys } from "@/lib/productionPlan";
import { readOrderProductionPlan, readProductionPlanStore } from "@/lib/productionPlan.server";

export async function GET(request: Request) {
  const { user, error: authError } = await authorize("orders:read");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const machineParam = url.searchParams.get("machineId");
    const requestedMachineId = Number(machineParam);
    if (machineParam !== null && (!Number.isInteger(requestedMachineId) || requestedMachineId <= 0)) {
      return NextResponse.json({ error: "A valid machineId is required." }, { status: 400 });
    }
    const machineId = machineParam === null ? undefined : requestedMachineId;
    if (machineId && baseRoleOf(user.role) === "Machine Operator") {
      const assignedStations = await listMachinesForUser(user);
      if (!assignedStations.some((machine) => machine.id === machineId)) {
        return NextResponse.json({ error: "You are not assigned to this machine station." }, { status: 403 });
      }
    }
    const status = url.searchParams.get("status");
    const activeOnly = url.searchParams.get("activeOnly") === "true";
    const stationMode = url.searchParams.get("station") === "true" || Boolean(machineId && activeOnly);
    const activeStatuses = ["Ready", "In Progress", "Rejected/Rework"];

    // Apply record scope and the station/status filters in SQL. The former
    // endpoint loaded every operation, then discarded almost all of them in JS.
    let filtered = await listOperationsForUser(user, {
      machineId,
      statuses: activeOnly ? activeStatuses : undefined,
    });
    if (status && status !== "All") {
      filtered = filtered.filter((operation) => operation.status.toLowerCase() === status.toLowerCase());
    }

    // The station queue additionally surfaces, greyed out, jobs that were
    // offered to this station but already claimed at another station (the
    // short grace window lives in dataAccess; display-only, read-only).
    const claimedElsewhereIds = new Set<number>();
    if (stationMode && machineId && (!status || status === "All")) {
      const elsewhere = await listClaimedElsewhereOperationsForUser(user, machineId, Date.now());
      const knownIds = new Set(filtered.map((operation) => operation.id));
      for (const operation of elsewhere) {
        if (!knownIds.has(operation.id)) {
          filtered.push(operation);
          claimedElsewhereIds.add(operation.id);
        }
      }
    }

    const operationsWithCandidates = filtered.map((operation) => ({
      ...operation,
      candidateMachineIds: operationMachineCandidates(
        operation.id,
        operation.machineId,
        operation.status,
      ),
    }));

    const orderIds = Array.from(new Set(filtered.map((operation) => operation.orderId)));
    if (orderIds.length === 0) return NextResponse.json([]);
    const orderIdSet = new Set(orderIds);
    const planStore = readProductionPlanStore();
    const relevantPlans = Object.values(planStore.orders).filter((plan) => orderIdSet.has(plan.orderId));
    const operationBindings = new Map<number, { item: any; step: any; batchNumber: number }>();
    for (const plan of relevantPlans) {
      plan.items.forEach((item, index) => {
        for (const step of item.steps) {
          operationBindings.set(step.operationId, { item, step, batchNumber: index + 1 });
        }
      });
    }

    // Schedule/Gantt callers need operation rows only. Material, route and BOM
    // overlays are loaded exclusively for Station Mode, cutting several DB and
    // filesystem reads from every generic operations refresh.
    if (!stationMode) {
      return NextResponse.json(operationsWithCandidates.map((operation) => {
        const binding = operationBindings.get(operation.id);
        return binding ? {
          ...operation,
          machineCategory: operation.machineCategory || binding.step.machineCategory,
          productionItem: {
            materialId: binding.item.materialId,
            batchNumber: binding.batchNumber,
            name: binding.item.name,
            recipeName: binding.item.recipeName,
            routeSource: binding.item.routeSource,
            routePosition: binding.step.position,
            routeLength: binding.item.steps.length,
            steps: binding.item.steps,
          },
        } : operation;
      }));
    }

    const [stepRows, mats] = await Promise.all([
      db
        .select({
          orderId: orderOperations.orderId,
          operationName: orderOperations.operationName,
          stepOrder: orderOperations.stepOrder,
        })
        .from(orderOperations)
        .where(inArray(orderOperations.orderId, orderIds))
        .orderBy(asc(orderOperations.stepOrder)),
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
    ]);

    const stepsByOrder = new Map<number, string[]>();
    for (const operation of stepRows) {
      const list = stepsByOrder.get(operation.orderId) ?? [];
      if (!list.includes(operation.operationName)) list.push(operation.operationName);
      stepsByOrder.set(operation.orderId, list);
    }

    const progress = readAllProgress();
    const routes = readAllRoutes();
    const bomState = readBomBoardState();
    const bomEntries = bomState.entries;
    const receivedEntries = bomState.received;
    const plannedMaterials = new Map<number, any>();
    for (const plan of relevantPlans) {
      for (const item of plan.items) plannedMaterials.set(item.materialId, item);
    }

    const materialsByOrder = new Map<number, any[]>();
    for (const material of mats) {
      const list = materialsByOrder.get(material.orderId) ?? [];
      const live = progress[String(material.id)];
      const planned = plannedMaterials.get(material.id);
      const fulfilment = bomEntries[String(material.id)];
      list.push({
        ...material,
        stage: live?.stage ?? "",
        stageAt: live?.at ?? "",
        stageBy: live?.by ?? "",
        route: planned ? routeStageKeys(planned) : (routes[String(material.id)] ?? null),
        productionItemName: planned?.name ?? null,
        status: fulfilment?.status ?? "Requested",
        machineId: fulfilment?.machineId ?? planned?.steps?.[0]?.machineId ?? null,
        deliveredQty: fulfilment?.deliveredQty ?? null,
      });
      materialsByOrder.set(material.orderId, list);
    }

    return NextResponse.json(operationsWithCandidates.map((operation) => {
      const binding = operationBindings.get(operation.id);
      const orderBom = materialsByOrder.get(operation.orderId) ?? [];
      const reception = receivedEntries[String(operation.orderId)];
      const shared = {
        ...operation,
        orderBom,
        received: reception?.received ?? null,
        receivedState: reception?.state ?? (
          reception?.received === true ? "Received" : reception?.received === false ? "Not Received" : null
        ),
      };
      const elsewhereFlag = claimedElsewhereIds.has(operation.id)
        ? {
            claimedElsewhere: true,
            claimedByMachineCode: operation.machineCode ?? null,
            claimedAt: operation.startTime ?? null,
          }
        : {};
      if (!binding) {
        return {
          ...shared,
          ...elsewhereFlag,
          materials: orderBom,
          orderSteps: stepsByOrder.get(operation.orderId) ?? [],
        };
      }
      return {
        ...shared,
        ...elsewhereFlag,
        machineCategory: operation.machineCategory || binding.step.machineCategory,
        materials: orderBom.filter((material: any) => material.id === binding.item.materialId),
        orderSteps: routeStageKeys(binding.item),
        productionItem: {
          materialId: binding.item.materialId,
          batchNumber: binding.batchNumber,
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
