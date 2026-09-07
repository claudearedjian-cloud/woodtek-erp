import { NextResponse } from "next/server";
import { db } from "@/db";
import { orders, customers, orderOperations, machines, operationTemplates, users } from "@/db/schema";
import { eq, desc, asc } from "drizzle-orm";
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
          const matchingMachine = allMachines.find(m => m.category.toLowerCase().includes(step.machineCategory?.toLowerCase() || "")) || allMachines[0];
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
        await db.insert(orderOperations).values({
          orderId: newOrder.id,
          machineId: step.machineId ? Number(step.machineId) : null,
          stepOrder: i + 1,
          operationName: step.operationName || `Operation ${i + 1}`,
          estimatedMinutes: step.estimatedMinutes ? Number(step.estimatedMinutes) : 60,
          status: i === 0 ? "Ready" : "Pending",
        });
      }
    } else {
      const saw = allMachines.find(m => m.category === "Panel Saw") || allMachines[0];
      const asm = allMachines.find(m => m.category === "Assembly Table") || allMachines[1] || allMachines[0];
      await db.insert(orderOperations).values([
        { orderId: newOrder.id, machineId: saw?.id || null, stepOrder: 1, operationName: "Standard Panel Sizing & Cutting", estimatedMinutes: 90, status: "Ready" },
        { orderId: newOrder.id, machineId: asm?.id || null, stepOrder: 2, operationName: "Assembly & Quality Assurance", estimatedMinutes: 120, status: "Pending" },
      ]);
    }

    return NextResponse.json(newOrder, { status: 201 });
  } catch (error: any) {
    console.error("POST order error:", error);
    return NextResponse.json({ error: error?.message || "Failed to create order" }, { status: 500 });
  }
}
