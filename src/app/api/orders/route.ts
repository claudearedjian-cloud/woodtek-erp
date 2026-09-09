import { NextResponse } from "next/server";
import { db } from "@/db";
import { orders, customers, orderOperations, machines, operationTemplates, users, downtimeEvents, orderMaterials, inventoryItems } from "@/db/schema";
import { and, eq, desc, asc, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { chooseFreestMachine } from "@/lib/machineCategories";
import { authorize } from "@/lib/auth";
import { listOrdersForUser } from "@/lib/dataAccess";
import { getSessionUser } from "@/lib/auth";

export async function GET(request: Request) {
  // The auth gate requires a signed-in user with orders:read.
  // Per-record scoping is applied below by listOrdersForUser.
  const { user, error: authError } = await authorize("orders:read");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");

    const scopedOrders = await listOrdersForUser(user, { status: status ?? undefined });

    // For each order, fetch summary of operations and active station
    // (within the same scoping rules).
    const allOperations = await db
      .select({
        id: orderOperations.id,
        orderId: orderOperations.orderId,
        stepOrder: orderOperations.stepOrder,
        operationName: orderOperations.operationName,
        status: orderOperations.status,
        machineName: machines.name,
        machineCode: machines.code,
      })
      .from(orderOperations)
      .leftJoin(machines, eq(orderOperations.machineId, machines.id))
      .orderBy(asc(orderOperations.stepOrder));

    const allowedOrderIds = new Set(scopedOrders.map(o => o.id));

    const enrichedOrders = scopedOrders.map(order => {
      const ops = allOperations
        .filter(o => o.orderId === order.id && allowedOrderIds.has(o.orderId))
        .map(o => ({
          id: o.id,
          orderId: o.orderId,
          stepOrder: o.stepOrder,
          operationName: o.operationName,
          status: o.status,
          machineCode: o.machineCode,
          machineName: o.machineName,
        }));
      const totalSteps = ops.length;
      const completedSteps = ops.filter(o => o.status === "Completed").length;
      const currentOp = ops.find(o => o.status === "In Progress")
        || ops.find(o => o.status === "Ready")
        || ops.find(o => o.status === "Pending")
        || ops[ops.length - 1];

      return {
        ...order,
        totalSteps,
        completedSteps,
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
  if (candidates.length === 0) candidates = allMachines;

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

    const finalOrderNum = orderNumber || `ORD-2026-${Math.floor(1000 + Math.random() * 9000)}`;

    // For Sales users, auto-set ownership columns. Managers can optionally
    // pick an assignedSalesId from the body.
    const createdById = user.id;
    const assignedSalesId =
      user.role === "Sales Coordinator"
        ? user.id
        : (body.assignedSalesId ? Number(body.assignedSalesId) : null);

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
    if (Array.isArray(body.bom) && body.bom.length > 0) {
      const lines = (body.bom as any[])
        .map((b) => ({ itemId: Number(b?.itemId), qty: Math.max(1, Number(b?.quantityUsed) || 1) }))
        .filter((b) => Number.isInteger(b.itemId) && b.itemId > 0);
      if (lines.length > 0) {
        const items = await db
          .select({ id: inventoryItems.id, unitCost: inventoryItems.unitCost })
          .from(inventoryItems)
          .where(inArray(inventoryItems.id, lines.map((l) => l.itemId)));
        const costOf = new Map(items.map((i) => [i.id, i.unitCost]));
        await db.insert(orderMaterials).values(
          lines.map((l) => ({
            orderId: newOrder.id,
            itemId: l.itemId,
            quantityUsed: l.qty,
            costPerUnit: costOf.get(l.itemId) ?? "0.00",
          })),
        );
      }
    }

    return NextResponse.json(newOrder, { status: 201 });
  } catch (error: any) {
    console.error("POST order error:", error);
    return NextResponse.json({ error: error?.message || "Failed to create order" }, { status: 500 });
  }
}
