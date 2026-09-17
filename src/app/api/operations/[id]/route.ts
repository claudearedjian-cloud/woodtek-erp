import { NextResponse } from "next/server";
import { db } from "@/db";
import { orderOperations, orders, machines, qualityEvents, orderMaterials, users } from "@/db/schema";
import { readReceived } from "@/lib/bomStatus.server";
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, ne, or } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { canUserUpdateOperation } from "@/lib/dataAccess";
import { baseRoleOf, canAssignMachines } from "@/lib/permissions";
import { stageLadder } from "@/lib/materialProgress";
import { routeLadder } from "@/lib/materialRoutes";
import { readAllProgress } from "@/lib/materialProgress.server";
import { readAllRoutes } from "@/lib/materialRoutes.server";
import { autoCompleteMaterialsForStep, markPlannedMaterialAtOperation } from "@/lib/materialProgress.server";
import { jobLockedByOther } from "@/lib/jobLock";
import { findProductionStepByOperation, nextProductionOperationId, previousProductionOperationId } from "@/lib/productionPlan";
import { readOrderProductionPlan, productionStepForOperation, updateProductionStepMachine } from "@/lib/productionPlan.server";
import {
  clearOperationMachineCandidates,
  operationMachineCandidates,
  setOperationMachineCandidates,
} from "@/lib/operationMachineCandidates.server";
import { candidateStatusIsClaimable, sanitizeCandidateMachineIds } from "@/lib/operationMachineCandidates";
import { readBomStatus, setBomStatus } from "@/lib/bomStatus.server";

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

    if (
      body.candidateMachineIds !== undefined
      && Object.keys(body).some((key) => key !== "candidateMachineIds")
    ) {
      return NextResponse.json(
        { error: "Candidate stations must be saved as their own assignment action." },
        { status: 400 },
      );
    }

    // Per-record check: a pure machine/candidate assignment from a role holding
    // operations:assign-machine bypasses the station-crew check. A station Start
    // carries stationMachineId so a candidate crew member receives only the
    // narrow authorization needed to atomically claim that operation.
    const assignmentOnlyRequest = Object.keys(body).length > 0
      && Object.keys(body).every((key) => key === "machineId" || key === "candidateMachineIds");
    let check: { allowed: boolean; reason?: string } = { allowed: true };
    if (!(assignmentOnlyRequest && canAssignMachines(user.role))) {
      check = await canUserUpdateOperation(user, operationId, {
        stationMachineId: body.stationMachineId !== undefined ? Number(body.stationMachineId) : undefined,
        requestedStatus: typeof body.status === "string" ? body.status : undefined,
      });
    }
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
      // Floor Supervisors may move a step between equivalent machines (same
      // category) — validated further inside the transaction below.
      if (body.machineId !== undefined && !canAssignMachines(user.role)) restricted.push("machineId");
      if (body.candidateMachineIds !== undefined && !canAssignMachines(user.role)) restricted.push("candidateMachineIds");
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
    if (
      body.stationMachineId !== undefined
      && (!Number.isInteger(Number(body.stationMachineId)) || Number(body.stationMachineId) <= 0)
    ) {
      return NextResponse.json({ error: "A valid stationMachineId is required." }, { status: 400 });
    }
    if (body.stationMachineId !== undefined && body.status !== "In Progress") {
      return NextResponse.json({ error: "stationMachineId is accepted only when starting work." }, { status: 400 });
    }

    const result = await db.transaction(async (tx) => {
      const [currentOp] = await tx.select().from(orderOperations).where(eq(orderOperations.id, operationId));
      if (!currentOp) throw new WorkflowError("Operation step not found.", 404);
      const productionPlan = readOrderProductionPlan(currentOp.orderId);
      const plannedBinding = findProductionStepByOperation(productionPlan, currentOp.id);

      const requestedStatus = body.status as string | undefined;
      if (requestedStatus && !allowedStatuses.includes(requestedStatus)) {
        throw new WorkflowError("Unsupported operation status.", 400);
      }

      let requestedCandidateMachineIds: number[] | null = null;
      if (body.candidateMachineIds !== undefined) {
        if (!Array.isArray(body.candidateMachineIds)) {
          throw new WorkflowError("Candidate stations must be an array of machine ids.", 400);
        }
        requestedCandidateMachineIds = sanitizeCandidateMachineIds(body.candidateMachineIds);
        if (
          requestedCandidateMachineIds.length === 0
          || requestedCandidateMachineIds.length !== body.candidateMachineIds.length
        ) {
          throw new WorkflowError("Choose one or more valid, non-duplicate candidate stations.", 400);
        }
        if (!candidateStatusIsClaimable(currentOp.status)) {
          throw new WorkflowError("Candidate stations can be changed only before this operation first starts.", 409);
        }

        const assignBom = await tx
          .select({ id: orderMaterials.id })
          .from(orderMaterials)
          .where(eq(orderMaterials.orderId, currentOp.orderId));
        if (assignBom.length > 0 && readReceived()[String(currentOp.orderId)]?.received !== true) {
          throw new WorkflowError("Candidate stations can be chosen only after the Floor Supervisor approves reception.", 409);
        }

        const selectedMachines = await tx
          .select()
          .from(machines)
          .where(inArray(machines.id, requestedCandidateMachineIds));
        if (selectedMachines.length !== requestedCandidateMachineIds.length) {
          throw new WorkflowError("One or more candidate stations no longer exist.", 404);
        }
        const [currentMachine] = currentOp.machineId
          ? await tx.select().from(machines).where(eq(machines.id, currentOp.machineId))
          : [undefined];
        const requiredCategory = plannedBinding?.step.machineCategory
          ?? currentMachine?.category
          ?? selectedMachines[0]?.category;
        const wrongCategory = selectedMachines.find((machine) =>
          machine.category.toLowerCase() !== String(requiredCategory ?? "").toLowerCase()
        );
        if (wrongCategory) {
          throw new WorkflowError(`Only ${requiredCategory} machines can be candidates for this step.`, 409);
        }
        const unavailable = selectedMachines.find((machine) =>
          machine.status === "Maintenance" || machine.status === "Offline"
        );
        if (unavailable) {
          throw new WorkflowError(`${unavailable.code} is ${unavailable.status.toLowerCase()} and cannot be a candidate.`, 409);
        }
      }

      // Crew lock: while a job is running only the operator who started it
      // (or Manager / supervisor roles) may control it — other machine crew
      // members are view-only. Mirrors the greyed-out Station Mode buttons.
      if (requestedStatus && jobLockedByOther(currentOp, user.id, baseRoleOf(user.role) === "Machine Operator")) {
        const [starter] = await tx.select({ name: users.name }).from(users).where(eq(users.id, currentOp.operatorId as number));
        throw new WorkflowError(`This job is being run by ${starter?.name ?? "another operator"} — view only for you.`, 403);
      }
      if (
        body.machineId !== undefined &&
        (currentOp.status === "In Progress" || currentOp.status === "Completed") &&
        (body.machineId ? Number(body.machineId) : null) !== currentOp.machineId
      ) {
        throw new WorkflowError("The machine can no longer be changed once work has started.", 409);
      }

      // Floor Supervisor machine choice: same-category equivalent machines,
      // only before work starts, only after reception approval.
      if (body.machineId !== undefined && user.role !== "Manager" && canAssignMachines(user.role)) {
        const chosenMachineId = body.machineId ? Number(body.machineId) : null;
        if (!chosenMachineId) {
          throw new WorkflowError("A machine id is required.", 400);
        }
        if (currentOp.status === "In Progress" || currentOp.status === "Completed") {
          throw new WorkflowError("The machine can no longer be changed once work has started.", 409);
        }
        const [targetMachine] = await tx.select().from(machines).where(eq(machines.id, chosenMachineId));
        if (!targetMachine) throw new WorkflowError("The selected machine no longer exists.", 404);
        if (targetMachine.status === "Maintenance" || targetMachine.status === "Offline") {
          throw new WorkflowError(`${targetMachine.code} is ${targetMachine.status.toLowerCase()} and cannot accept work.`, 409);
        }
        // Same-category equivalents when a machine is already assigned; when the
        // step has none yet, the Floor Supervisor may give it any active machine.
        if (currentOp.machineId) {
          const [currentMachine] = await tx.select().from(machines).where(eq(machines.id, currentOp.machineId));
          if (currentMachine && targetMachine.category !== currentMachine.category) {
            throw new WorkflowError(`Only ${currentMachine.category} machines can run this step.`, 409);
          }
        } else if (plannedBinding && targetMachine.category.toLowerCase() !== plannedBinding.step.machineCategory.toLowerCase()) {
          throw new WorkflowError(`Only ${plannedBinding.step.machineCategory} machines can run this material pass.`, 409);
        }
        const assignBom = await tx
          .select({ id: orderMaterials.id })
          .from(orderMaterials)
          .where(eq(orderMaterials.orderId, currentOp.orderId));
        if (assignBom.length > 0 && readReceived()[String(currentOp.orderId)]?.received !== true) {
          throw new WorkflowError("Machines can be chosen only after the Floor Supervisor approves reception.", 409);
        }
      }

      // Managers retain full assignment access, but a planned pass can never be
      // sent to a machine from the wrong category (that would break its route).
      if (body.machineId !== undefined && user.role === "Manager" && plannedBinding && body.machineId) {
        const chosenMachineId = Number(body.machineId);
        if (!Number.isInteger(chosenMachineId) || chosenMachineId <= 0) {
          throw new WorkflowError("A valid machine id is required.", 400);
        }
        const [targetMachine] = await tx.select().from(machines).where(eq(machines.id, chosenMachineId));
        if (!targetMachine) throw new WorkflowError("The selected machine no longer exists.", 404);
        if (targetMachine.category.toLowerCase() !== plannedBinding.step.machineCategory.toLowerCase()) {
          throw new WorkflowError(`Only ${plannedBinding.step.machineCategory} machines can run this material pass.`, 409);
        }
        if (targetMachine.status === "Maintenance" || targetMachine.status === "Offline") {
          throw new WorkflowError(`${targetMachine.code} is ${targetMachine.status.toLowerCase()} and cannot accept work.`, 409);
        }
      }

      const stationMachineId = body.stationMachineId !== undefined
        ? Number(body.stationMachineId)
        : null;
      const firstStartClaim = requestedStatus === "In Progress" && candidateStatusIsClaimable(currentOp.status);
      const currentCandidates = operationMachineCandidates(currentOp.id, currentOp.machineId, currentOp.status);
      if (firstStartClaim && stationMachineId && !currentCandidates.includes(stationMachineId)) {
        throw new WorkflowError("This operation was already claimed at another candidate station. Refresh the station queue.", 409);
      }
      if (!firstStartClaim && stationMachineId && stationMachineId !== currentOp.machineId) {
        throw new WorkflowError("This operation is running at another machine station. Refresh the station queue.", 409);
      }
      const candidatePrimaryMachineId = requestedCandidateMachineIds
        ? (currentOp.machineId && requestedCandidateMachineIds.includes(currentOp.machineId)
            ? currentOp.machineId
            : requestedCandidateMachineIds[0])
        : null;
      const targetMachineId = stationMachineId && firstStartClaim
        ? stationMachineId
        : requestedCandidateMachineIds
          ? candidatePrimaryMachineId
          : body.machineId !== undefined
            ? (body.machineId ? Number(body.machineId) : null)
            : currentOp.machineId;

      // Starting work is intentionally strict: predecessors, station availability,
      // and station capacity are validated atomically inside one transaction.
      if (requestedStatus === "In Progress") {
        if (currentOp.status === "Completed" && body.allowRework !== true) {
          throw new WorkflowError("Completed work requires an explicit rework action before restarting.", 409);
        }
        if (!targetMachineId) {
          throw new WorkflowError("Assign a machine station before starting this operation.", 409);
        }

        if (plannedBinding) {
          // V2: sequencing belongs to THIS material chain only. Operations for
          // other materials in the same order are independent and never block it.
          const predecessorId = previousProductionOperationId(productionPlan, currentOp.id);
          if (predecessorId) {
            const [predecessor] = await tx
              .select({ status: orderOperations.status })
              .from(orderOperations)
              .where(eq(orderOperations.id, predecessorId))
              .limit(1);
            if (!predecessor || predecessor.status !== "Completed") {
              throw new WorkflowError(`Finish the previous job for “${plannedBinding.item.name}” before starting this pass.`, 409);
            }
          }
        } else {
          const incompletePredecessors = await tx
            .select({ id: orderOperations.id })
            .from(orderOperations)
            .where(and(
              eq(orderOperations.orderId, currentOp.orderId),
              lt(orderOperations.stepOrder, currentOp.stepOrder),
              ne(orderOperations.status, "Completed")
            ));
          if (incompletePredecessors.length > 0) {
            // Legacy per-material overlay: retain the earlier material-ready
            // exception for orders that pre-date the v2 production plan.
            const materialLines = await tx
              .select({ id: orderMaterials.id })
              .from(orderMaterials)
              .where(eq(orderMaterials.orderId, currentOp.orderId));
            let materialReady = false;
            if (materialLines.length > 0) {
              const opsAll = await tx
                .select({ name: orderOperations.operationName, stepOrder: orderOperations.stepOrder })
                .from(orderOperations)
                .where(eq(orderOperations.orderId, currentOp.orderId));
              const orderLadder = stageLadder(opsAll.sort((a, b) => a.stepOrder - b.stepOrder).map((o) => o.name));
              const [thisMachine] = currentOp.machineId
                ? await tx.select({ category: machines.category }).from(machines).where(eq(machines.id, currentOp.machineId))
                : [{ category: null as string | null }];
              const progress = readAllProgress();
              const routes = readAllRoutes();
              materialReady = materialLines.some((line) => {
                const stage = (progress[String(line.id)]?.stage ?? "").trim();
                if (!stage) return false;
                const own = routes[String(line.id)];
                const ladder = own ? routeLadder(own) : orderLadder;
                const position = ladder.indexOf(stage);
                const targetPosition = own ? ladder.indexOf(thisMachine?.category ?? "") : ladder.indexOf(currentOp.operationName);
                return position !== -1 && targetPosition !== -1 && position >= targetPosition;
              });
            }
            if (!materialReady) {
              throw new WorkflowError("A previous operation is incomplete. Finish the sequence before starting this station.", 409);
            }
          }
        }

        // Material gate: an order with a BOM cannot enter production until the
        // Floor Supervisor has approved reception at the station.
        // A valid v2 binding always owns a material row, so its plan proves a
        // BOM exists without another database round trip. Legacy orders retain
        // the explicit allocation lookup.
        const hasBomLines = plannedBinding
          ? true
          : (await tx
              .select({ id: orderMaterials.id })
              .from(orderMaterials)
              .where(eq(orderMaterials.orderId, currentOp.orderId))
              .limit(1)).length > 0;
        if (hasBomLines && readReceived()[String(currentOp.orderId)]?.received !== true) {
          throw new WorkflowError("Material reception for this order has NOT been approved. Ask the Floor Supervisor to approve the BOM reception before starting.", 409);
        }

        // Validate machine availability and its one-job capacity in one query.
        const [station] = await tx
          .select({
            id: machines.id,
            code: machines.code,
            category: machines.category,
            status: machines.status,
            runningOperationId: orderOperations.id,
            runningOperationName: orderOperations.operationName,
          })
          .from(machines)
          .leftJoin(orderOperations, and(
            eq(orderOperations.machineId, machines.id),
            eq(orderOperations.status, "In Progress"),
            ne(orderOperations.id, currentOp.id),
          ))
          .where(eq(machines.id, targetMachineId))
          .limit(1);
        if (!station) throw new WorkflowError("The assigned machine no longer exists.", 409);
        if (plannedBinding && station.category.toLowerCase() !== plannedBinding.step.machineCategory.toLowerCase()) {
          throw new WorkflowError(`This pass requires a ${plannedBinding.step.machineCategory} machine.`, 409);
        }
        if (station.status === "Maintenance" || station.status === "Offline") {
          throw new WorkflowError(`${station.code} is ${station.status.toLowerCase()} and cannot accept work.`, 409);
        }
        if (station.runningOperationId) {
          throw new WorkflowError(`${station.code} is already running “${station.runningOperationName}”. Complete or pause it first.`, 409);
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
      if (body.machineId !== undefined || requestedCandidateMachineIds || firstStartClaim) {
        updateData.machineId = targetMachineId;
      }
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
        if (currentOp.status === "Completed") {
          updateData.actualMinutes = 0;
          updateData.scheduledStart = null;
          updateData.scheduledEnd = null;
        }
      }
      if (requestedStatus === "Completed") updateData.endTime = new Date();

      // Compare-and-set makes the first candidate Start the only winner. Two
      // stations may read the same Ready card, but only one can still match the
      // original status + machine tuple when PostgreSQL performs this UPDATE.
      const compareWaitingAssignment = !firstStartClaim
        && candidateStatusIsClaimable(currentOp.status)
        && (requestedCandidateMachineIds !== null || body.machineId !== undefined);
      const claimWhere = firstStartClaim || compareWaitingAssignment
        ? and(
            eq(orderOperations.id, operationId),
            eq(orderOperations.status, currentOp.status),
            currentOp.machineId === null
              ? isNull(orderOperations.machineId)
              : eq(orderOperations.machineId, currentOp.machineId),
          )
        : eq(orderOperations.id, operationId);
      const [updatedOp] = await tx
        .update(orderOperations)
        .set(updateData)
        .where(claimWhere)
        .returning();
      if (!updatedOp) {
        throw new WorkflowError(
          firstStartClaim
            ? "Another station claimed this operation first. Refresh the station queue."
            : "This waiting operation changed while stations were being saved. Refresh and try again.",
          409,
        );
      }

      const persistedMachineChanged = updatedOp.machineId !== currentOp.machineId;
      if (
        plannedBinding
        && (body.machineId !== undefined || requestedCandidateMachineIds || persistedMachineChanged)
      ) {
        updateProductionStepMachine(updatedOp.orderId, updatedOp.id, targetMachineId);
      }

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
      if (
        requestedStatus === "Completed"
        || (requestedStatus === "In Progress" && (currentOp.status === "Rejected/Rework" || Boolean(currentOp.rejectReason)))
      ) {
        const targetDisposition = requestedStatus === "Completed" ? "Reworked & Passed" : "In Rework";
        await tx.update(qualityEvents)
          .set({ disposition: targetDisposition, resolvedAt: requestedStatus === "Completed" ? new Date() : null })
          .where(and(
            eq(qualityEvents.operationId, updatedOp.id),
            eq(qualityEvents.eventType, "rework"),
            or(eq(qualityEvents.disposition, "Open"), eq(qualityEvents.disposition, "In Rework")),
          ));
      }

      // One compact order snapshot serves readiness, rework progress and the
      // parent status calculation. Keep it current in memory after the writes
      // below instead of issuing the same full-order SELECT a second time.
      const allOps = await tx
        .select({
          id: orderOperations.id,
          stepOrder: orderOperations.stepOrder,
          status: orderOperations.status,
          parentOrderStatus: orders.status,
        })
        .from(orderOperations)
        .innerJoin(orders, eq(orderOperations.orderId, orders.id))
        .where(eq(orderOperations.orderId, updatedOp.orderId))
        .orderBy(asc(orderOperations.stepOrder));

      if (updatedOp.status === "Completed") {
        const plannedNextId = nextProductionOperationId(productionPlan, updatedOp.id);
        const nextStep = plannedBinding
          ? allOps.find((operation) => operation.id === plannedNextId && operation.status === "Pending")
          : allOps.find((operation) => operation.stepOrder > updatedOp.stepOrder && operation.status === "Pending");
        if (nextStep) {
          await tx.update(orderOperations)
            .set({ status: "Ready", updatedAt: new Date() })
            .where(eq(orderOperations.id, nextStep.id));
          nextStep.status = "Ready";
        }
      }

      // Rework invalidates only this material's downstream chain in a v2 plan.
      if (updatedOp.status === "In Progress" && currentOp.status === "Completed") {
        const plannedDownstreamIds = plannedBinding
          ? new Set(plannedBinding.item.steps.slice(plannedBinding.index + 1).map((step) => step.operationId))
          : null;
        for (const downstream of allOps.filter((operation) =>
          plannedDownstreamIds
            ? plannedDownstreamIds.has(operation.id)
            : operation.stepOrder > updatedOp.stepOrder && operation.status !== "Completed"
        )) {
          await tx.update(orderOperations)
            .set(plannedDownstreamIds
              ? {
                  status: "Pending",
                  startTime: null,
                  endTime: null,
                  scheduledStart: null,
                  scheduledEnd: null,
                  actualMinutes: 0,
                  operatorId: null,
                  updatedAt: new Date(),
                }
              : { status: "Pending", updatedAt: new Date() })
            .where(eq(orderOperations.id, downstream.id));
          downstream.status = "Pending";
        }
      }

      const completedCount = allOps.filter((operation) => operation.status === "Completed").length;
      const progressPercent = allOps.length > 0 ? Math.round((completedCount / allOps.length) * 100) : 0;

      let orderStatus = allOps[0]?.parentOrderStatus || "Pending";
      if (progressPercent === 100) orderStatus = "Completed";
      else if (updatedOp.status === "Rejected/Rework") orderStatus = "On Hold";
      else if (updatedOp.status === "In Progress" || progressPercent > 0) orderStatus = "In Production";
      else if (orderStatus === "Completed") orderStatus = "In Production";

      await tx.update(orders)
        .set({ progressPercent, status: orderStatus })
        .where(eq(orders.id, updatedOp.orderId));

      return {
        operation: updatedOp,
        progressPercent,
        orderStatus,
        machineClaimed: firstStartClaim,
        requestedCandidateMachineIds,
        persistedMachineChanged,
      };
    });

    // Candidate storage is advisory before Start. As soon as one station wins,
    // collapse the overlay to that persisted machine; queue visibility already
    // collapses atomically from the relational status + machine update above.
    try {
      if (result.requestedCandidateMachineIds) {
        setOperationMachineCandidates(
          result.operation.id,
          result.requestedCandidateMachineIds,
          user.id,
        );
      } else if (result.machineClaimed || body.machineId !== undefined) {
        if (result.operation.machineId) {
          setOperationMachineCandidates(result.operation.id, [result.operation.machineId], user.id);
        }
      }
    } catch (error) {
      console.warn("Candidate station overlay sync skipped:", error instanceof Error ? error.message : error);
    }

    // Keep the warehouse destination aligned with the first private pass. This
    // overlay is display/fulfilment context, so a write failure must not undo a
    // valid operation update.
    if (body.machineId !== undefined || result.requestedCandidateMachineIds || result.persistedMachineChanged) {
      const binding = productionStepForOperation(result.operation.orderId, result.operation.id);
      if (binding?.index === 0) {
        try {
          const existing = readBomStatus().entries[String(binding.item.materialId)];
          setBomStatus(
            binding.item.materialId,
            existing?.status ?? "Requested",
            result.operation.machineId,
            existing?.deliveredQty ?? null,
          );
        } catch (error) {
          console.warn("Warehouse target sync skipped:", error instanceof Error ? error.message : error);
        }
      }
    }

    // Comprehensive flow: completing a machine step carries every material
    // still sitting on it one stage further (a forgotten "Finished here"
    // tap can never strand a cut list). Starting a step moves nothing —
    // materials advance when the operator taps, or when the step completes.
    if (result.operation.status === "In Progress") {
      markPlannedMaterialAtOperation(result.operation.orderId, result.operation.id, user.name || user.role);
    }
    if (result.operation.status === "Completed") {
      await autoCompleteMaterialsForStep(
        result.operation.orderId,
        result.operation.machineId,
        result.operation.operationName,
        result.operation.id,
      );
    }
    logAudit(
      user,
      "operation.update",
      "operation",
      `${result.operation.operationName}: ${String(body.status ?? result.operation.status)}`
        + `${body.machineId !== undefined ? " · machine reassigned" : ""}`
        + `${result.requestedCandidateMachineIds ? ` · ${result.requestedCandidateMachineIds.length} candidate station(s)` : ""}`
        + `${result.machineClaimed ? ` · claimed machine ${result.operation.machineId}` : ""}`,
      result.operation.id,
    );
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
    if (readOrderProductionPlan(Number(orderId))) {
      return NextResponse.json(
        { error: "Add or change passes through the material production plan, not as a loose order step." },
        { status: 409 },
      );
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
      if (productionStepForOperation(operation.orderId, operation.id)) {
        throw new WorkflowError("This pass belongs to an independent material route and cannot be deleted by itself.", 409);
      }
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
    clearOperationMachineCandidates([operationId]);
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
