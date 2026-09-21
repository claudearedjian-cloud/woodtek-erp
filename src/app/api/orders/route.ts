import { NextResponse } from "next/server";
import { db } from "@/db";
import { orders, customers, orderOperations, machines, operationTemplates, users, downtimeEvents, orderMaterials, inventoryItems } from "@/db/schema";
import { and, eq, desc, asc, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { chooseFreestMachine } from "@/lib/machineCategories";
import { setBomStatus } from "@/lib/bomStatus.server";
import { authorize } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { listOrdersForUser } from "@/lib/dataAccess";
import { nextOrderNumber } from "@/lib/orderNumbers.server";
import { getSessionUser } from "@/lib/auth";
import {
  productionStageKey,
  sanitizeProductionItems,
  sanitizeProductionRoute,
  type PlannedProductionItem,
  type ProductionRouteStep,
} from "@/lib/productionPlan";
import { saveOrderProductionPlan } from "@/lib/productionPlan.server";
import { applyMaterialsStatus, computeAvailability } from "@/lib/materials";
import { evaluateStockLine, stockCheckSummary, type StockCheckLine } from "@/lib/stockCheck";
import { ensureDispatchBatches, ensureLegacyDispatchOrder } from "@/lib/dispatch.server";
import { autoScheduleDispatchSlots, type DispatchSchedulingResult } from "@/lib/dispatchScheduling.server";

export async function GET(request: Request) {
  // The auth gate requires a signed-in user with orders:read.
  // Per-record scoping is applied below by listOrdersForUser.
  const { user, error: authError } = await authorize("orders:read");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");

    const scopedOrders = await listOrdersForUser(user, { status: status ?? undefined });

    if (scopedOrders.length === 0) return NextResponse.json([]);

    // Fetch operation summaries only for already-authorized orders, then group
    // once. The former implementation scanned the full operation table and
    // re-filtered it for every order (O(orders × operations)).
    const orderIds = scopedOrders.map((order) => order.id);
    const operationRows = await db
      .select({
        id: orderOperations.id,
        orderId: orderOperations.orderId,
        stepOrder: orderOperations.stepOrder,
        operationName: orderOperations.operationName,
        status: orderOperations.status,
        scheduledStart: orderOperations.scheduledStart,
        scheduledEnd: orderOperations.scheduledEnd,
        machineName: machines.name,
        machineCode: machines.code,
      })
      .from(orderOperations)
      .leftJoin(machines, eq(orderOperations.machineId, machines.id))
      .where(inArray(orderOperations.orderId, orderIds))
      .orderBy(asc(orderOperations.stepOrder));

    const operationsByOrder = new Map<number, typeof operationRows>();
    for (const operation of operationRows) {
      const list = operationsByOrder.get(operation.orderId) ?? [];
      list.push(operation);
      operationsByOrder.set(operation.orderId, list);
    }

    const enrichedOrders = scopedOrders.map(order => {
      const ops = operationsByOrder.get(order.id) ?? [];
      const totalSteps = ops.length;
      const completedSteps = ops.filter(o => o.status === "Completed").length;
      const scheduledSteps = ops.filter(o => o.scheduledStart && o.scheduledEnd).length;
      const currentOp = ops.find(o => o.status === "In Progress")
        || ops.find(o => o.status === "Ready")
        || ops.find(o => o.status === "Pending")
        || ops[ops.length - 1];

      return {
        ...order,
        totalSteps,
        completedSteps,
        scheduledSteps,
        currentStation: currentOp ? {
          operationName: currentOp.operationName,
          machineCode: currentOp.machineCode || "Unassigned",
          machineName: currentOp.machineName || "Pending station allocation",
          status: currentOp.status,
        } : null,
        operations: ops,
      };
    });

    return NextResponse.json(enrichedOrders);
  } catch (error: any) {
    console.error("GET orders error:", error);
    return NextResponse.json({ error: error?.message || "Failed to fetch orders" }, { status: 500 });
  }
}

/**
 * Automatic machine assignment: among the machines of the given category,
 * pick the one with the least open work. Machines in Maintenance/Offline and
 * machines under active (unresolved) downtime are avoided unless nothing
 * else is left. Never blocks order creation — falls back to any machine.
 */
async function pickFreestMachine(allMachines: typeof machines.$inferSelect[], categoryName: string) {
  const cat = String(categoryName || "").trim().toLowerCase();
  let candidates = cat
    ? allMachines.filter((m) => String(m.category || "").toLowerCase() === cat)
    : [];
  if (candidates.length === 0 && cat) {
    candidates = allMachines.filter((m) => String(m.category || "").toLowerCase().includes(cat));
  }
  // A named category must never fall through to an unrelated machine. An
  // unmatched pass stays unassigned for explicit supervisor correction.
  if (candidates.length === 0 && !cat) candidates = allMachines;

  const healthy = candidates.filter((m) => m.status !== "Maintenance" && m.status !== "Offline");
  if (healthy.length > 0) candidates = healthy;

  // Open work per machine (Pending / Ready / In Progress).
  const load: Record<number, number> = {};
  try {
    const rows = await db
      .select({ machineId: orderOperations.machineId, n: sql<number>`count(*)::int` })
      .from(orderOperations)
      .where(and(isNotNull(orderOperations.machineId), inArray(orderOperations.status, ["Pending", "Ready", "In Progress"])))
      .groupBy(orderOperations.machineId);
    for (const r of rows) {
      if (r.machineId != null) load[r.machineId] = Number(r.n) || 0;
    }
    // Active downtime: push to the back of the queue.
    const down = await db
      .select({ machineId: downtimeEvents.machineId })
      .from(downtimeEvents)
      .where(isNull(downtimeEvents.endedAt));
    for (const d of down) {
      load[d.machineId] = (load[d.machineId] ?? 0) + 1_000_000;
    }
  } catch {
    /* load info is best-effort; fall back to id order */
  }
  return chooseFreestMachine(candidates, load);
}

type PlannedAssignmentStep = ProductionRouteStep & { assignedMachineId: number | null };

/**
 * Resolve every v2 material-job pass before opening the creation transaction.
 * Unlike the legacy fallback, a missing category NEVER receives an unrelated
 * machine. It stays unassigned and is made visible to the supervisor.
 */
async function prepareProductionAssignments(
  allMachines: typeof machines.$inferSelect[],
  items: ReturnType<typeof sanitizeProductionItems>,
): Promise<Array<Omit<(typeof items)[number], "steps"> & { steps: PlannedAssignmentStep[] }>> {
  const load: Record<number, number> = {};
  try {
    const rows = await db
      .select({ machineId: orderOperations.machineId, n: sql<number>`count(*)::int` })
      .from(orderOperations)
      .where(and(isNotNull(orderOperations.machineId), inArray(orderOperations.status, ["Pending", "Ready", "In Progress"])))
      .groupBy(orderOperations.machineId);
    for (const row of rows) {
      if (row.machineId != null) load[row.machineId] = Number(row.n) || 0;
    }
    const down = await db
      .select({ machineId: downtimeEvents.machineId })
      .from(downtimeEvents)
      .where(isNull(downtimeEvents.endedAt));
    for (const row of down) load[row.machineId] = (load[row.machineId] ?? 0) + 1_000_000;
  } catch {
    /* assignment still works with an empty load map */
  }

  return items.map((item) => ({
    ...item,
    steps: item.steps.map((step) => {
      if (!step.auto) {
        if (!step.machineId) return { ...step, assignedMachineId: null };
        const exact = allMachines.find((machine) => machine.id === step.machineId);
        if (!exact) throw new Error(`The exact machine selected for “${step.operationName}” no longer exists.`);
        load[exact.id] = (load[exact.id] ?? 0) + 1;
        return { ...step, machineCategory: exact.category, assignedMachineId: exact.id };
      }

      const category = step.machineCategory.toLowerCase();
      let candidates = allMachines.filter((machine) => machine.category.toLowerCase() === category);
      if (candidates.length === 0) {
        candidates = allMachines.filter((machine) => machine.category.toLowerCase().includes(category));
      }
      const normalizedCategory = candidates[0]?.category ?? step.machineCategory;
      candidates = candidates.filter((machine) => machine.status !== "Maintenance" && machine.status !== "Offline");
      const selected = chooseFreestMachine(candidates, load);
      if (selected) load[selected.id] = (load[selected.id] ?? 0) + 1;
      return {
        ...step,
        machineCategory: selected?.category ?? normalizedCategory,
        assignedMachineId: selected?.id ?? null,
      };
    }),
  }));
}

/**
 * Classify the stock impact of the just-issued order's lines from a
 * PRE-ISSUE snapshot (taken before this order's reservation rows land), so
 * the post-issue alert names anything that goes short or below reorder.
 */
function buildStockCheck(
  entries: Array<{ itemId: number; quantity: number }>,
  details: Map<number, { sku: string; name: string; reorderLevel: number }>,
  snapshot: Map<number, { stockQuantity: number; reserved: number; available: number }>,
) {
  const lines = entries
    .map((entry) => {
      const detail = details.get(entry.itemId);
      const availability = snapshot.get(entry.itemId);
      if (!detail || !availability) return null;
      return evaluateStockLine({
        sku: detail.sku,
        name: detail.name,
        quantity: entry.quantity,
        stockQuantity: availability.stockQuantity,
        reservedBefore: availability.reserved,
        reorderLevel: detail.reorderLevel,
      });
    })
    .filter((line): line is StockCheckLine => line !== null);
  return stockCheckSummary(lines);
}

type IssuedOrderScheduling = DispatchSchedulingResult & { failed?: boolean };

async function scheduleIssuedOrder(orderId: number): Promise<IssuedOrderScheduling> {
  try {
    return await autoScheduleDispatchSlots({ orderIds: [orderId] });
  } catch (error) {
    console.error(`Automatic Dispatch booking failed for order ${orderId}:`, error);
    return {
      attempted: 0,
      planned: 0,
      skipped: 1,
      skippedDetails: ["Automatic slot booking failed. Open Dispatch and use Auto-plan after checking machine availability."],
      dueDateWarnings: [],
      placements: [],
      failed: true,
    };
  }
}

export async function POST(request: Request) {
  const { user, error: authError } = await authorize("orders:write");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const {
      orderNumber,
      customerId,
      title,
      projectType,
      priority = "Normal",
      totalValue = "0.00",
      dueDate,
      notes,
      templateId,
      customSteps = [],
    } = body;

    if (!customerId || !title || !dueDate) {
      return NextResponse.json({ error: "Customer, Title, and Due Date are required." }, { status: 400 });
    }

    // Sales Coordinator creating an order: ensure the customer belongs to them.
    // Manager can create orders for any customer.
    if (user.role === "Sales Coordinator") {
      const [customer] = await db
        .select({ id: customers.id, assignedSalesId: customers.assignedSalesId })
        .from(customers)
        .where(eq(customers.id, Number(customerId)));
      if (!customer) {
        return NextResponse.json({ error: "Customer not found." }, { status: 404 });
      }
      if (customer.assignedSalesId && customer.assignedSalesId !== user.id) {
        return NextResponse.json(
          { error: "This customer is assigned to another sales rep." },
          { status: 403 },
        );
      }
    }

    // Sequential PO-0001/<year> — per-year counter, auto-resets each new year.
    const finalOrderNum = orderNumber || (await nextOrderNumber());

    // For Sales users, auto-set ownership columns. Managers can optionally
    // pick an assignedSalesId from the body.
    const createdById = user.id;
    const assignedSalesId =
      user.role === "Sales Coordinator"
        ? user.id
        : (body.assignedSalesId ? Number(body.assignedSalesId) : null);

    // V2 production builder: each named material row owns an independent,
    // fully snapshotted operation chain. This is one server submission — no
    // follow-up route request that can fail silently.
    if (Array.isArray(body.productionItems) && body.productionItems.length > 0) {
      const cleanItems = sanitizeProductionItems(body.productionItems);
      const hasPartialRoute = body.productionItems.some((item: any) =>
        !Array.isArray(item?.steps) || sanitizeProductionRoute(item.steps).length !== item.steps.length
      );
      if (cleanItems.length !== body.productionItems.length || hasPartialRoute) {
        return NextResponse.json(
          { error: "Every material job needs a batch name, stock item, quantity, and complete route." },
          { status: 400 },
        );
      }

      const requestedItemIds = Array.from(new Set(cleanItems.map((item) => item.itemId)));
      const stockRows = await db
        .select({
          id: inventoryItems.id,
          unitCost: inventoryItems.unitCost,
          sku: inventoryItems.sku,
          name: inventoryItems.name,
          reorderLevel: inventoryItems.reorderLevel,
        })
        .from(inventoryItems)
        .where(inArray(inventoryItems.id, requestedItemIds));
      if (stockRows.length !== requestedItemIds.length) {
        return NextResponse.json({ error: "One or more selected inventory items no longer exist." }, { status: 400 });
      }
      const costOf = new Map(stockRows.map((item) => [item.id, item.unitCost]));
      const allMachines = await db.select().from(machines);
      const missingExact = cleanItems
        .flatMap((item) => item.steps)
        .find((step) => !step.auto && step.machineId && !allMachines.some((machine) => machine.id === step.machineId));
      if (missingExact) {
        return NextResponse.json(
          { error: `The exact machine selected for “${missingExact.operationName}” no longer exists.` },
          { status: 409 },
        );
      }
      const preparedItems = await prepareProductionAssignments(allMachines, cleanItems);
      const cleanDefaultSteps = sanitizeProductionRoute(body.defaultSteps);
      const materialTargets: Array<{ materialId: number; machineId: number | null }> = [];

      // Pre-issue stock snapshot (this order's reservation rows don't exist
      // yet), used for the post-issue "Stock check" alert.
      const stockSnapshot = await computeAvailability();
      const stockDetails = new Map(
        stockRows.map((item) => [item.id, { sku: item.sku, name: item.name, reorderLevel: item.reorderLevel }]),
      );

      const created = await db.transaction(async (tx) => {
        const [newOrder] = await tx.insert(orders).values({
          orderNumber: finalOrderNum,
          customerId: Number(customerId),
          title,
          projectType: projectType || "Custom Furniture",
          priority,
          status: "Pending",
          totalValue: String(totalValue),
          dueDate: new Date(dueDate),
          progressPercent: 0,
          notes: notes || null,
          createdById,
          assignedSalesId,
        }).returning();

        const plannedItems: PlannedProductionItem[] = [];
        const createdMaterials: { id: number }[] = [];
        let globalStepOrder = 1;
        for (const item of preparedItems) {
          const [material] = await tx
            .insert(orderMaterials)
            .values({
              orderId: newOrder.id,
              itemId: item.itemId,
              quantityUsed: item.quantityUsed,
              costPerUnit: costOf.get(item.itemId) ?? "0.00",
            })
            .returning({ id: orderMaterials.id });
          createdMaterials.push(material);

          const plannedSteps: PlannedProductionItem["steps"] = [];
          for (let index = 0; index < item.steps.length; index++) {
            const step = item.steps[index];
            const [operation] = await tx
              .insert(orderOperations)
              .values({
                orderId: newOrder.id,
                machineId: step.assignedMachineId,
                stepOrder: globalStepOrder++,
                operationName: step.operationName,
                estimatedMinutes: step.estimatedMinutes,
                status: index === 0 ? "Ready" : "Pending",
              })
              .returning({ id: orderOperations.id });
            plannedSteps.push({
              operationId: operation.id,
              position: index + 1,
              stageKey: productionStageKey(index + 1, step.operationName),
              operationName: step.operationName,
              machineCategory: step.machineCategory,
              estimatedMinutes: step.estimatedMinutes,
              auto: step.auto,
              machineId: step.assignedMachineId,
            });
          }

          materialTargets.push({ materialId: material.id, machineId: item.steps[0]?.assignedMachineId ?? null });
          plannedItems.push({
            materialId: material.id,
            itemId: item.itemId,
            name: item.name,
            quantityUsed: item.quantityUsed,
            routeSource: item.routeSource,
            recipeId: item.recipeId,
            recipeName: item.recipeName,
            steps: plannedSteps,
          });
        }

        // Write before the DB transaction commits. A file-write failure rolls
        // the relational inserts back instead of returning a route-less order.
        const productionPlan = {
          orderId: newOrder.id,
          createdAt: new Date().toISOString(),
          defaultSteps: cleanDefaultSteps,
          items: plannedItems,
        };
        saveOrderProductionPlan(productionPlan);
        return { newOrder, createdMaterials, productionPlan };
      });

      for (const target of materialTargets) {
        try {
          setBomStatus(target.materialId, "Requested", target.machineId);
        } catch (error) {
          console.warn("Initial warehouse target could not be written:", error);
        }
      }
      try {
        await ensureDispatchBatches({
          orderId: created.newOrder.id,
          materialIds: created.createdMaterials.map((material) => material.id),
          projectType: created.newOrder.projectType,
          createdAt: created.newOrder.createdAt,
          orderStatus: created.newOrder.status,
        });
      } catch (error) {
        // GET /api/dispatch self-heals a missed entry, but creation normally
        // persists every material batch before this response is returned.
        console.warn("Initial material-batch Dispatch entries could not be written:", error);
      }
      // "Issue order" includes real production appointments, not just machine
      // assignment. Every private material chain is booked now while all
      // existing Dispatch appointments reserve their machine capacity.
      const dispatchScheduling = await scheduleIssuedOrder(created.newOrder.id);
      let materialsStatus = created.newOrder.materialsStatus;
      try {
        materialsStatus = await applyMaterialsStatus(created.newOrder.id);
      } catch (error) {
        console.warn("Initial material availability status could not be computed:", error);
      }
      const stockCheck = buildStockCheck(
        created.productionPlan.items.map((item) => ({ itemId: item.itemId, quantity: item.quantityUsed })),
        stockDetails,
        stockSnapshot,
      );
      logAudit(
        user,
        "order.create",
        "order",
        `${created.newOrder.orderNumber} created for ${title} · ${created.productionPlan.items.length} material job(s) · ${dispatchScheduling.planned}/${dispatchScheduling.attempted} Dispatch slot(s) booked`,
        created.newOrder.id,
      );
      return NextResponse.json(
        {
          ...created.newOrder,
          materialsStatus,
          createdMaterials: created.createdMaterials,
          productionPlan: created.productionPlan,
          dispatchScheduling,
          stockCheck,
        },
        { status: 201 },
      );
    }

    const [newOrder] = await db.insert(orders).values({
      orderNumber: finalOrderNum,
      customerId: Number(customerId),
      title,
      projectType: projectType || "Custom Furniture",
      priority,
      status: "Pending",
      totalValue: String(totalValue),
      dueDate: new Date(dueDate),
      progressPercent: 0,
      notes: notes || null,
      createdById,
      assignedSalesId,
    }).returning();

    const allMachines = await db.select().from(machines);

    if (templateId) {
      const [tpl] = await db.select().from(operationTemplates).where(eq(operationTemplates.id, Number(templateId)));
      if (tpl && Array.isArray(tpl.defaultStepsJson)) {
        for (let i = 0; i < tpl.defaultStepsJson.length; i++) {
          const step = tpl.defaultStepsJson[i] as any;
          const matchingMachine = await pickFreestMachine(allMachines, step.machineCategory || "");
          await db.insert(orderOperations).values({
            orderId: newOrder.id,
            machineId: matchingMachine ? matchingMachine.id : null,
            stepOrder: step.stepOrder || i + 1,
            operationName: step.operationName || `Step ${i + 1}`,
            estimatedMinutes: step.estimatedMinutes || 60,
            status: i === 0 ? "Ready" : "Pending",
          });
        }
      }
    } else if (customSteps.length > 0) {
      for (let i = 0; i < customSteps.length; i++) {
        const step = customSteps[i];
        const autoMachine = step.auto && !step.machineId
          ? await pickFreestMachine(allMachines, step.machineCategory || "")
          : null;
        await db.insert(orderOperations).values({
          orderId: newOrder.id,
          machineId: step.machineId ? Number(step.machineId) : (autoMachine ? autoMachine.id : null),
          stepOrder: i + 1,
          operationName: step.operationName || `Operation ${i + 1}`,
          estimatedMinutes: step.estimatedMinutes ? Number(step.estimatedMinutes) : 60,
          status: i === 0 ? "Ready" : "Pending",
        });
      }
    } else {
      const saw = (await pickFreestMachine(allMachines, "Panel Saw")) || allMachines[0];
      const asm = (await pickFreestMachine(allMachines, "Assembly Table")) || allMachines[1] || allMachines[0];
      await db.insert(orderOperations).values([
        { orderId: newOrder.id, machineId: saw?.id || null, stepOrder: 1, operationName: "Standard Panel Sizing & Cutting", estimatedMinutes: 90, status: "Ready" },
        { orderId: newOrder.id, machineId: asm?.id || null, stepOrder: 2, operationName: "Assembly & Quality Assurance", estimatedMinutes: 120, status: "Pending" },
      ]);
    }

    // Optional BOM lines entered on the new-order form. They land in the same
    // orderMaterials table as manual allocations (warehouse board + BOM tab).
    let createdMaterials: { id: number }[] = [];
    let stockCheck: { warnings: string[]; lines: StockCheckLine[] } = { warnings: [], lines: [] };
    if (Array.isArray(body.bom) && body.bom.length > 0) {
      const lines = (body.bom as any[])
        .map((b) => ({ itemId: Number(b?.itemId), qty: Math.max(1, Number(b?.quantityUsed) || 1) }))
        .filter((b) => Number.isInteger(b.itemId) && b.itemId > 0);
      if (lines.length > 0) {
        const items = await db
          .select({
            id: inventoryItems.id,
            unitCost: inventoryItems.unitCost,
            sku: inventoryItems.sku,
            name: inventoryItems.name,
            reorderLevel: inventoryItems.reorderLevel,
          })
          .from(inventoryItems)
          .where(inArray(inventoryItems.id, lines.map((l) => l.itemId)));
        const costOf = new Map(items.map((i) => [i.id, i.unitCost]));
        // Pre-issue snapshot for the post-issue "Stock check" alert.
        const stockSnapshot = await computeAvailability();
        const inserted = await db
          .insert(orderMaterials)
          .values(
            lines.map((l) => ({
              orderId: newOrder.id,
              itemId: l.itemId,
              quantityUsed: l.qty,
              costPerUnit: costOf.get(l.itemId) ?? "0.00",
            })),
          )
          .returning({ id: orderMaterials.id });
        createdMaterials = inserted;

        // Materials travel to the FIRST machine of the routing sequence; the
        // warehouse sees it read-only, only a Manager may re-route later.
        const [firstOp] = await db
          .select({ machineId: orderOperations.machineId })
          .from(orderOperations)
          .where(eq(orderOperations.orderId, newOrder.id))
          .orderBy(asc(orderOperations.stepOrder));
        const firstMachine = firstOp?.machineId ?? null;
        for (const row of inserted) {
          setBomStatus(row.id, "Requested", firstMachine);
        }
        stockCheck = buildStockCheck(
          lines.map((l) => ({ itemId: l.itemId, quantity: l.qty })),
          new Map(items.map((i) => [i.id, { sku: i.sku, name: i.name, reorderLevel: i.reorderLevel }])),
          stockSnapshot,
        );
      }
    }

    try {
      if (createdMaterials.length > 0) {
        await ensureDispatchBatches({
          orderId: newOrder.id,
          materialIds: createdMaterials.map((material) => material.id),
          projectType: newOrder.projectType,
          createdAt: newOrder.createdAt,
          orderStatus: newOrder.status,
        });
      } else {
        await ensureLegacyDispatchOrder({
          orderId: newOrder.id,
          projectType: newOrder.projectType,
          createdAt: newOrder.createdAt,
          orderStatus: newOrder.status,
        });
      }
    } catch (error) {
      console.warn("Initial Dispatch reservation could not be written:", error);
    }

    const dispatchScheduling = await scheduleIssuedOrder(newOrder.id);
    logAudit(
      user,
      "order.create",
      "order",
      `${newOrder.orderNumber} created for ${title} · ${dispatchScheduling.planned}/${dispatchScheduling.attempted} Dispatch slot(s) booked`,
      newOrder.id,
    );
    return NextResponse.json({ ...newOrder, createdMaterials, dispatchScheduling, stockCheck }, { status: 201 });
  } catch (error: any) {
    console.error("POST order error:", error);
    return NextResponse.json({ error: error?.message || "Failed to create order" }, { status: 500 });
  }
}
