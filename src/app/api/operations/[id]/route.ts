import { NextResponse } from "next/server";
import { db } from "@/db";
import { orderOperations, orders, machines, qualityEvents } from "@/db/schema";
import { and, asc, eq, gt, isNotNull, lt, ne, or } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { canUserUpdateOperation } from "@/lib/dataAccess";

const allowedStatuses = ["Pending", "Ready", "In Progress", "Completed", "Rejected/Rework"];

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error: authError } = await authorize("operations:update-status");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await context.params;
    const operationId = Number(id);
    const body = await request.json();

    if (!Number.isInteger(operationId)) {
      return NextResponse.json({ error: "Invalid operation identifier." }, { status: 400 });
    }

    // Per-record check: non-Managers may only update operations they are
    // assigned to (as operator, or via the operation's machine assignment).
    const check = await canUserUpdateOperation(user, operationId);
    if (!check.allowed) {
      return NextResponse.json({ error: check.reason || "Not authorized for this operation." }, { status: 403 });
    }

    // Non-Managers may only change: status, qualityNotes, rejectReason, actualMinutes.
    // Any other field (machineId, scheduledStart, operatorId, estimatedMinutes) is
    // reserved for full operations:write (Manager only) — EXCEPT that an operator
    // may set operatorId to THEMSELVES (self-attribution when starting a job at
    // their station). Reassigning to someone else stays Manager-only.
    if (user.role !== "Manager") {
      const restricted: string[] = [];
      if (body.machineId !== undefined) restricted.push("machineId");
      if (body.scheduledStart !== undefined) restricted.push("scheduledStart");
      if (body.scheduledEnd !== undefined) restricted.push("scheduledEnd");
      if (body.operatorId !== undefined && Number(body.operatorId) !== Number(user.id)) restricted.push("operatorId");
      if (body.estimatedMinutes !== undefined) restricted.push("estimatedMinutes");
      if (restricted.length > 0) {
        return NextResponse.json(
          { error: `Only a Manager can change: ${restricted.join(", ")}.` },
          { status: 403 },
        );
      }
    }

    const result = await db.transaction(async (tx) => {
      const [currentOp] = await tx.select().from(orderOperations).where(eq(orderOperations.id, operationId));
      if (!currentOp) throw new WorkflowError("Operation step not found.", 404);

      const requestedStatus = body.status as string | undefined;
      if (requestedStatus && !allowedStatuses.includes(requestedStatus)) {
        throw new WorkflowError("Unsupported operation status.", 400);
      }

      const targetMachineId = body.machineId !== undefined
        ? (body.machineId ? Number(body.machineId) : null)
        : currentOp.machineId;

      // Starting work is intentionally strict: predecessors, station availability,
      // and station capacity are validated atomically inside one transaction.
      if (requestedStatus === "In Progress") {
        if (currentOp.status === "Pending") {
          throw new WorkflowError("This step is locked until every previous operation is completed.", 409);
        }
        if (currentOp.status === "Completed" && body.allowRework !== true) {
          throw new WorkflowError("Completed work requires an explicit rework action before restarting.", 409);
        }
        if (!targetMachineId) {
          throw new WorkflowError("Assign a machine station before starting this operation.", 409);
        }

        const incompletePredecessors = await tx
          .select({ id: orderOperations.id })
          .from(orderOperations)
          .where(and(
            eq(orderOperations.orderId, currentOp.orderId),
            lt(orderOperations.stepOrder, currentOp.stepOrder),
            ne(orderOperations.status, "Completed")
          ));
        if (incompletePredecessors.length > 0) {
          throw new WorkflowError("A previous operation is incomplete. Finish the sequence before starting this station.", 409);
        }

        const [station] = await tx.select().from(machines).where(eq(machines.id, targetMachineId));
        if (!station) throw new WorkflowError("The assigned machine no longer exists.", 409);
        if (station.status === "Maintenance" || station.status === "Offline") {
          throw new WorkflowError(`${station.code} is ${station.status.toLowerCase()} and cannot accept work.`, 409);
        }

        const runningOnStation = await tx
          .select({ id: orderOperations.id, operationName: orderOperations.operationName })
          .from(orderOperations)
          .where(and(
            eq(orderOperations.machineId, targetMachineId),
            eq(orderOperations.status, "In Progress"),
            ne(orderOperations.id, currentOp.id)
          ));
        if (runningOnStation.length > 0) {
          throw new WorkflowError(`${station.code} is already running “${runningOnStation[0].operationName}”. Complete or pause it first.`, 409);
        }
      }

      if (requestedStatus === "Completed" && currentOp.status !== "In Progress") {
        throw new WorkflowError("Only an operation currently in progress can be completed.", 409);
      }
      if (requestedStatus === "Rejected/Rework" && !String(body.rejectReason || "").trim()) {
        throw new WorkflowError("Enter a defect or rework reason before rejecting this operation.", 400);
      }

      const scheduledStart = body.scheduledStart !== undefined
        ? (body.scheduledStart ? new Date(body.scheduledStart) : null)
        : currentOp.scheduledStart;
      const scheduledEnd = body.scheduledEnd !== undefined
        ? (body.scheduledEnd ? new Date(body.scheduledEnd) : null)
        : currentOp.scheduledEnd;

      if ((scheduledStart && Number.isNaN(scheduledStart.getTime())) || (scheduledEnd && Number.isNaN(scheduledEnd.getTime()))) {
        throw new WorkflowError("Schedule times must be valid dates.", 400);
      }
      if ((scheduledStart && !scheduledEnd) || (!scheduledStart && scheduledEnd)) {
        throw new WorkflowError("A scheduled start and end time are both required.", 400);
      }
      if (scheduledStart && scheduledEnd && scheduledEnd <= scheduledStart) {
        throw new WorkflowError("Scheduled end must be later than scheduled start.", 400);
      }
      if (scheduledStart && scheduledEnd && !targetMachineId) {
        throw new WorkflowError("Assign a machine before scheduling this operation.", 409);
      }
      if (scheduledStart && scheduledEnd && targetMachineId) {
        const [scheduledMachine] = await tx.select().from(machines).where(eq(machines.id, targetMachineId));
        if (!scheduledMachine) throw new WorkflowError("The selected machine no longer exists.", 409);
        if (scheduledMachine.status === "Maintenance" || scheduledMachine.status === "Offline") {
          throw new WorkflowError(`${scheduledMachine.code} is unavailable for scheduling while ${scheduledMachine.status.toLowerCase()}.`, 409);
        }

        const overlapping = await tx.select({ id: orderOperations.id, operationName: orderOperations.operationName })
          .from(orderOperations)
          .where(and(
            eq(orderOperations.machineId, targetMachineId),
            ne(orderOperations.id, currentOp.id),
            isNotNull(orderOperations.scheduledStart),
            isNotNull(orderOperations.scheduledEnd),
            lt(orderOperations.scheduledStart, scheduledEnd),
            gt(orderOperations.scheduledEnd, scheduledStart)
          ));
        if (overlapping.length > 0) {
          throw new WorkflowError(`${scheduledMachine.code} already has “${overlapping[0].operationName}” booked in that time window.`, 409);
        }
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (requestedStatus !== undefined) updateData.status = requestedStatus;
      if (body.machineId !== undefined) updateData.machineId = targetMachineId;
      if (body.scheduledStart !== undefined || body.scheduledEnd !== undefined) {
        updateData.scheduledStart = scheduledStart;
        updateData.scheduledEnd = scheduledEnd;
      }
      if (body.operatorId !== undefined) updateData.operatorId = body.operatorId ? Number(body.operatorId) : null;
      if (body.actualMinutes !== undefined) updateData.actualMinutes = Math.max(0, Number(body.actualMinutes));
      if (body.estimatedMinutes !== undefined) updateData.estimatedMinutes = Math.max(1, Number(body.estimatedMinutes));
      if (body.qualityNotes !== undefined) updateData.qualityNotes = String(body.qualityNotes).trim() || null;
      if (body.rejectReason !== undefined) updateData.rejectReason = String(body.rejectReason).trim() || null;

      if (requestedStatus === "In Progress") {
        updateData.startTime = currentOp.status === "Completed" ? new Date() : (currentOp.startTime || new Date());
        updateData.endTime = null;
      }
      if (requestedStatus === "Completed") updateData.endTime = new Date();

      const [updatedOp] = await tx
        .update(orderOperations)
        .set(updateData)
        .where(eq(orderOperations.id, operationId))
        .returning();

      // --- Scrap & rework tracking -------------------------------------
      // A rejection is recorded as a quality event in the same transaction so
      // the defect trail survives even if the operation row is later changed.
      if (requestedStatus === "Rejected/Rework") {
        const disposition = body.rejectDisposition === "Scrap" ? "scrap" : "rework";
        const rawQty = Math.floor(Number(body.rejectQuantity ?? 1));
        const quantity = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
        await tx.insert(qualityEvents).values({
          orderId: updatedOp.orderId,
          operationId: updatedOp.id,
          machineId: targetMachineId,
          eventType: disposition,
          quantity,
          unit: "pcs",
          reason: String(body.rejectReason || "").trim(),
          disposition: disposition === "scrap" ? "Scrapped" : "Open",
          estimatedCost: "0.00",
          recordedById: user.id,
          notes: null,
          resolvedAt: disposition === "scrap" ? new Date() : null,
        });
      }

      // Recovering from a rejection closes the open rework event on this step:
      // restarting work marks it "In Rework", completing it marks it passed.
      if (requestedStatus === "In Progress" || requestedStatus === "Completed") {
        const targetDisposition = requestedStatus === "Completed" ? "Reworked & Passed" : "In Rework";
        await tx.update(qualityEvents)
          .set({ disposition: targetDisposition, resolvedAt: requestedStatus === "Completed" ? new Date() : null })
          .where(and(
            eq(qualityEvents.operationId, updatedOp.id),
            eq(qualityEvents.eventType, "rework"),
            or(eq(qualityEvents.disposition, "Open"), eq(qualityEvents.disposition, "In Rework")),
          ));
      }

      const allOps = await tx
        .select()
        .from(orderOperations)
        .where(eq(orderOperations.orderId, updatedOp.orderId))
        .orderBy(asc(orderOperations.stepOrder));

      if (updatedOp.status === "Completed") {
        const nextStep = allOps.find(o => o.stepOrder > updatedOp.stepOrder && o.status === "Pending");
        if (nextStep) {
          await tx.update(orderOperations)
            .set({ status: "Ready", updatedAt: new Date() })
            .where(eq(orderOperations.id, nextStep.id));
        }
      }

      // Rework invalidates downstream readiness so parts cannot skip the reopened step.
      if (updatedOp.status === "In Progress" && currentOp.status === "Completed") {
        for (const downstream of allOps.filter(o => o.stepOrder > updatedOp.stepOrder && o.status !== "Completed")) {
          await tx.update(orderOperations)
            .set({ status: "Pending", updatedAt: new Date() })
            .where(eq(orderOperations.id, downstream.id));
        }
      }

      const completedCount = allOps.filter(o => o.id === updatedOp.id ? updatedOp.status === "Completed" : o.status === "Completed").length;
      const progressPercent = allOps.length > 0 ? Math.round((completedCount / allOps.length) * 100) : 0;
      const [currentOrder] = await tx.select().from(orders).where(eq(orders.id, updatedOp.orderId));

      let orderStatus = currentOrder?.status || "Pending";
      if (progressPercent === 100) orderStatus = "Completed";
      else if (updatedOp.status === "Rejected/Rework") orderStatus = "On Hold";
      else if (updatedOp.status === "In Progress" || progressPercent > 0) orderStatus = "In Production";
      else if (orderStatus === "Completed") orderStatus = "In Production";

      await tx.update(orders)
        .set({ progressPercent, status: orderStatus })
        .where(eq(orders.id, updatedOp.orderId));

      return { operation: updatedOp, progressPercent, orderStatus };
    });

    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof WorkflowError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Failed to update operation";
    console.error("PATCH operation error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  // Adding a step to an order's workflow is a planning task - Manager only.
  const { error: authError } = await authorize("operations:create");
  if (authError) return authError;

  try {
    const body = await request.json();
    const { orderId, machineId, operationName, estimatedMinutes = 60, operatorId } = body;
    if (!orderId || !String(operationName || "").trim()) {
      return NextResponse.json({ error: "Order ID and operation name are required." }, { status: 400 });
    }

    const existingOps = await db.select().from(orderOperations)
      .where(eq(orderOperations.orderId, Number(orderId)))
      .orderBy(asc(orderOperations.stepOrder));
    const stepOrder = existingOps.length > 0 ? existingOps[existingOps.length - 1].stepOrder + 1 : 1;

    const [newOp] = await db.insert(orderOperations).values({
      orderId: Number(orderId),
      machineId: machineId ? Number(machineId) : null,
      stepOrder,
      operationName: String(operationName).trim(),
      estimatedMinutes: Math.max(1, Number(estimatedMinutes)),
      status: existingOps.length === 0 || existingOps.every(o => o.status === "Completed") ? "Ready" : "Pending",
      operatorId: operatorId ? Number(operatorId) : null,
    }).returning();

    return NextResponse.json(newOp, { status: 201 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to add step";
    console.error("POST operation error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  // Removing a step from an order's workflow is a planning task - Manager only.
  const { error: authError } = await authorize("operations:delete");
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const operationId = Number(id);
    const result = await db.transaction(async (tx) => {
      const [operation] = await tx.select().from(orderOperations).where(eq(orderOperations.id, operationId));
      if (!operation) throw new WorkflowError("Operation step not found.", 404);
      if (operation.status === "In Progress" || operation.status === "Completed") {
        throw new WorkflowError("Running or completed operations cannot be deleted. Re-plan the order instead.", 409);
      }

      await tx.delete(orderOperations).where(eq(orderOperations.id, operationId));
      const remaining = await tx.select().from(orderOperations)
        .where(eq(orderOperations.orderId, operation.orderId))
        .orderBy(asc(orderOperations.stepOrder));

      for (let index = 0; index < remaining.length; index += 1) {
        const nextOrder = index + 1;
        const desiredStatus = index === 0 && remaining[index].status === "Pending" ? "Ready" : remaining[index].status;
        if (remaining[index].stepOrder !== nextOrder || desiredStatus !== remaining[index].status) {
          await tx.update(orderOperations)
            .set({ stepOrder: nextOrder, status: desiredStatus, updatedAt: new Date() })
            .where(eq(orderOperations.id, remaining[index].id));
        }
      }

      const completedCount = remaining.filter(step => step.status === "Completed").length;
      const progressPercent = remaining.length > 0 ? Math.round((completedCount / remaining.length) * 100) : 0;
      await tx.update(orders)
        .set({ progressPercent, status: remaining.length === 0 ? "Pending" : progressPercent === 100 ? "Completed" : completedCount > 0 ? "In Production" : "Pending" })
        .where(eq(orders.id, operation.orderId));

      return { success: true, progressPercent };
    });
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof WorkflowError) return NextResponse.json({ error: error.message }, { status: error.status });
    const message = error instanceof Error ? error.message : "Failed to delete operation";
    console.error("DELETE operation error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

class WorkflowError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "WorkflowError";
  }
}
