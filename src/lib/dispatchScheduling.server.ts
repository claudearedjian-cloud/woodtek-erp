// ============================================================================
// Automatic production-Dispatch slot persistence — SERVER ONLY.
//
// All automatic and manual scheduling writes share one PostgreSQL transaction
// advisory lock. Automatic writes also compare the waiting operation's status,
// machine and empty schedule, so a simultaneous Start/reassignment always wins
// safely instead of being overwritten by a stale planner snapshot.
// ============================================================================

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { machines, orderOperations, orders } from "@/db/schema";
import {
  buildAutomaticDispatchPlan,
  DISPATCH_PLAN_STATUSES,
  type DispatchSlotPlacement,
} from "@/lib/dispatchScheduling";
import { readProductionPlanStore, updateProductionStepMachine } from "@/lib/productionPlan.server";
import { readBomStatus, setBomStatus } from "@/lib/bomStatus.server";

export interface DispatchSchedulingResult {
  attempted: number;
  planned: number;
  skipped: number;
  skippedDetails: string[];
  placements: Array<{
    operationId: number;
    machineId: number;
    scheduledStart: string;
    scheduledEnd: string;
  }>;
}

/** Keep this identical for every code path that writes production appointments. */
export async function lockDispatchSchedule(transaction: { execute: (query: any) => Promise<any> }): Promise<void> {
  await transaction.execute(sql`select pg_advisory_xact_lock(874221902)`);
}

function validTargetIds(values: readonly number[] | undefined): number[] | undefined {
  if (values === undefined) return undefined;
  return Array.from(new Set(
    values.map(Number).filter((id) => Number.isInteger(id) && id > 0),
  ));
}

/**
 * Book unscheduled Pending/Ready operations. When orderIds is supplied, only
 * those orders receive new slots; every existing appointment still reserves
 * machine capacity.
 */
export async function autoScheduleDispatchSlots(options: {
  orderIds?: readonly number[];
} = {}): Promise<DispatchSchedulingResult> {
  const targetOrderIds = validTargetIds(options.orderIds);
  if (targetOrderIds && targetOrderIds.length === 0) {
    return { attempted: 0, planned: 0, skipped: 0, skippedDetails: [], placements: [] };
  }

  const transactionResult = await db.transaction(async (tx) => {
    await lockDispatchSchedule(tx);
    const [allOperations, orderRows, machineRows] = await Promise.all([
      tx.select().from(orderOperations),
      tx.select({ id: orders.id, priority: orders.priority, dueDate: orders.dueDate }).from(orders),
      tx.select().from(machines),
    ]);

    const planStore = readProductionPlanStore();
    const bindings = new Map<number, {
      orderId: number;
      materialId: number;
      index: number;
      machineCategory: string;
      automaticMachine: boolean;
      predecessorOperationId: number | null;
    }>();
    for (const plan of Object.values(planStore.orders)) {
      for (const item of plan.items) {
        item.steps.forEach((step, index) => {
          bindings.set(step.operationId, {
            orderId: plan.orderId,
            materialId: item.materialId,
            index,
            machineCategory: step.machineCategory,
            automaticMachine: step.auto !== false,
            predecessorOperationId: index > 0 ? item.steps[index - 1].operationId : null,
          });
        });
      }
    }

    // Legacy orders have one flat chain. V2 operations instead use the private
    // predecessor recorded above, so sibling material batches remain parallel.
    const legacyPredecessor = new Map<number, number | null>();
    const operationsByOrder = new Map<number, typeof allOperations>();
    for (const operation of allOperations) {
      const list = operationsByOrder.get(operation.orderId) ?? [];
      list.push(operation);
      operationsByOrder.set(operation.orderId, list);
    }
    for (const list of operationsByOrder.values()) {
      list.sort((a, b) => a.stepOrder - b.stepOrder || a.id - b.id);
      list.forEach((operation, index) => {
        if (!bindings.has(operation.id)) {
          legacyPredecessor.set(operation.id, index > 0 ? list[index - 1].id : null);
        }
      });
    }

    const plan = buildAutomaticDispatchPlan({
      operations: allOperations.map((operation) => {
        const binding = bindings.get(operation.id);
        return {
          ...operation,
          requiredMachineCategory: binding?.machineCategory ?? null,
          predecessorOperationId: binding?.predecessorOperationId
            ?? legacyPredecessor.get(operation.id)
            ?? null,
          // A planned Auto pass may choose a category when still unassigned.
          // Exact passes deliberately remain visible exceptions for a manager.
          automaticMachine: binding ? binding.automaticMachine : operation.machineId == null,
        };
      }),
      orders: orderRows,
      machines: machineRows,
      targetOrderIds,
    });

    const persisted: DispatchSlotPlacement[] = [];
    const raceSkips: string[] = [];
    for (const placement of plan.placements) {
      const expectedMachine = placement.expectedMachineId === null
        ? isNull(orderOperations.machineId)
        : eq(orderOperations.machineId, placement.expectedMachineId);
      const [updated] = await tx
        .update(orderOperations)
        .set({
          machineId: placement.machineId,
          scheduledStart: new Date(placement.startMs),
          scheduledEnd: new Date(placement.endMs),
          updatedAt: new Date(),
        })
        .where(and(
          eq(orderOperations.id, placement.operationId),
          inArray(orderOperations.status, [...DISPATCH_PLAN_STATUSES]),
          isNull(orderOperations.scheduledStart),
          isNull(orderOperations.scheduledEnd),
          expectedMachine,
        ))
        .returning({ id: orderOperations.id });
      if (updated) persisted.push(placement);
      else raceSkips.push(`${placement.operationName}: operation changed while its slot was being booked`);
    }

    return {
      attempted: plan.attempted,
      persisted,
      bindings,
      skippedDetails: [
        ...plan.skipped.map((entry) => `${entry.operationName}: ${entry.reason}`),
        ...raceSkips,
      ],
    };
  });

  // Keep the no-migration material-plan snapshot and first warehouse target in
  // sync only when scheduling had to resolve a previously unassigned machine.
  for (const placement of transactionResult.persisted) {
    if (placement.expectedMachineId !== null) continue;
    const binding = transactionResult.bindings.get(placement.operationId);
    if (!binding) continue;
    try {
      updateProductionStepMachine(binding.orderId, placement.operationId, placement.machineId);
      if (binding.index === 0) {
        const current = readBomStatus().entries[String(binding.materialId)];
        setBomStatus(
          binding.materialId,
          current?.status ?? "Requested",
          placement.machineId,
          current?.deliveredQty ?? null,
        );
      }
    } catch (error) {
      console.warn(
        "Automatic Dispatch slot overlay sync skipped:",
        error instanceof Error ? error.message : error,
      );
    }
  }

  return {
    attempted: transactionResult.attempted,
    planned: transactionResult.persisted.length,
    skipped: transactionResult.skippedDetails.length,
    skippedDetails: transactionResult.skippedDetails.slice(0, 12),
    placements: transactionResult.persisted.map((placement) => ({
      operationId: placement.operationId,
      machineId: placement.machineId,
      scheduledStart: new Date(placement.startMs).toISOString(),
      scheduledEnd: new Date(placement.endMs).toISOString(),
    })),
  };
}
