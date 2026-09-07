import { NextResponse } from "next/server";
import { db } from "@/db";
import { orderOperations, orders, machines, users } from "@/db/schema";
import { eq, asc, desc, not } from "drizzle-orm";
import { authorize } from "@/lib/auth";

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

    return NextResponse.json(filtered);
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
