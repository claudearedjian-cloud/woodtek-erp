// ============================================================================
// Automatic production-Dispatch slot planner — pure/client-safe.
//
// A "Dispatch slot" is a concrete machine + scheduledStart + scheduledEnd on
// one order operation. The planner never writes data. Its server wrapper loads
// every existing booking, calls this function, then persists placements with a
// compare-and-set so order issuance cannot double-book a machine.
// ============================================================================

export const DISPATCH_PLAN_STATUSES = ["Pending", "Ready"] as const;

export interface DispatchSchedulingMachine {
  id: number;
  category: string;
  status: string;
}

export interface DispatchSchedulingOrder {
  id: number;
  priority?: string | null;
  dueDate?: Date | string | null;
}

export interface DispatchSchedulingOperation {
  id: number;
  orderId: number;
  machineId: number | null;
  stepOrder: number;
  operationName: string;
  estimatedMinutes: number | null;
  status: string;
  scheduledStart?: Date | string | null;
  scheduledEnd?: Date | string | null;
  endTime?: Date | string | null;
  /** Required machine category from the snapshotted material route. */
  requiredMachineCategory?: string | null;
  /** Private material-chain predecessor (legacy orders use prior stepOrder). */
  predecessorOperationId?: number | null;
  /** False means an unassigned exact-machine pass must stay an exception. */
  automaticMachine?: boolean;
}

export interface DispatchSlotPlacement {
  operationId: number;
  orderId: number;
  operationName: string;
  expectedMachineId: number | null;
  machineId: number;
  startMs: number;
  endMs: number;
}

export interface DispatchSlotSkip {
  operationId: number;
  orderId: number;
  operationName: string;
  reason: string;
}

export interface AutomaticDispatchPlan {
  attempted: number;
  placements: DispatchSlotPlacement[];
  skipped: DispatchSlotSkip[];
}

const PRIORITY_RANK: Record<string, number> = {
  Urgent: 0,
  High: 1,
  Normal: 2,
  Low: 3,
};

function timeMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  const result = parsed.getTime();
  return Number.isFinite(result) ? result : null;
}

function available(machine: DispatchSchedulingMachine): boolean {
  const status = String(machine.status || "").trim().toLowerCase();
  return status !== "maintenance" && status !== "offline";
}

function categoryMatches(actual: string, required: string): boolean {
  const a = String(actual || "").trim().toLowerCase();
  const r = String(required || "").trim().toLowerCase();
  return Boolean(a && r && (a === r || a.includes(r)));
}

function earliestGap(
  intervals: Array<[number, number]>,
  earliest: number,
  durationMs: number,
): number {
  let start = earliest;
  for (const [busyStart, busyEnd] of intervals.slice().sort((a, b) => a[0] - b[0])) {
    if (busyEnd <= start) continue;
    if (start + durationMs <= busyStart) break;
    start = busyEnd;
  }
  return start;
}

/**
 * Compute deterministic, conflict-free slots without mutating the inputs.
 * Existing bookings on every order reserve capacity, while targetOrderIds (if
 * supplied) limits which unscheduled operations receive new slots.
 */
export function buildAutomaticDispatchPlan(input: {
  operations: readonly DispatchSchedulingOperation[];
  orders: readonly DispatchSchedulingOrder[];
  machines: readonly DispatchSchedulingMachine[];
  targetOrderIds?: readonly number[];
  nowMs?: number;
}): AutomaticDispatchPlan {
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const targetIds = input.targetOrderIds === undefined
    ? null
    : new Set(input.targetOrderIds.map(Number).filter((id) => Number.isInteger(id) && id > 0));
  const machineById = new Map(input.machines.map((machine) => [machine.id, machine]));
  const orderById = new Map(input.orders.map((order) => [order.id, order]));

  // Every valid existing appointment is capacity, including completed work and
  // appointments belonging to orders outside this scheduling request.
  const busyByMachine = new Map<number, Array<[number, number]>>();
  const knownOperationEnd = new Map<number, number>();
  for (const operation of input.operations) {
    const scheduledStart = timeMs(operation.scheduledStart);
    const scheduledEnd = timeMs(operation.scheduledEnd);
    if (
      operation.machineId
      && scheduledStart !== null
      && scheduledEnd !== null
      && scheduledEnd > scheduledStart
    ) {
      const intervals = busyByMachine.get(operation.machineId) ?? [];
      intervals.push([scheduledStart, scheduledEnd]);
      busyByMachine.set(operation.machineId, intervals);
    }

    const actualEnd = timeMs(operation.endTime);
    if (scheduledEnd !== null) knownOperationEnd.set(operation.id, scheduledEnd);
    else if (actualEnd !== null) knownOperationEnd.set(operation.id, actualEnd);
    else if (operation.status === "Completed") knownOperationEnd.set(operation.id, nowMs);
  }

  const waitingStatuses = new Set<string>(DISPATCH_PLAN_STATUSES);
  const pending = input.operations
    .filter((operation) =>
      waitingStatuses.has(operation.status)
      && !operation.scheduledStart
      && !operation.scheduledEnd
      && (targetIds === null || targetIds.has(operation.orderId)),
    )
    .slice()
    .sort((a, b) => {
      const orderA = orderById.get(a.orderId);
      const orderB = orderById.get(b.orderId);
      const priorityA = PRIORITY_RANK[String(orderA?.priority ?? "Normal")] ?? PRIORITY_RANK.Normal;
      const priorityB = PRIORITY_RANK[String(orderB?.priority ?? "Normal")] ?? PRIORITY_RANK.Normal;
      if (priorityA !== priorityB) return priorityA - priorityB;
      const dueA = timeMs(orderA?.dueDate) ?? Number.MAX_SAFE_INTEGER;
      const dueB = timeMs(orderB?.dueDate) ?? Number.MAX_SAFE_INTEGER;
      if (dueA !== dueB) return dueA - dueB;
      if (a.orderId !== b.orderId) return a.orderId - b.orderId;
      if (a.stepOrder !== b.stepOrder) return a.stepOrder - b.stepOrder;
      return a.id - b.id;
    });

  const placements: DispatchSlotPlacement[] = [];
  const skipped: DispatchSlotSkip[] = [];
  let remaining = pending;

  // Usually one pass is enough because steps are sorted. The loop also handles
  // imported/legacy rows whose ids or stepOrder values are out of sequence.
  while (remaining.length > 0) {
    const remainingIds = new Set(remaining.map((operation) => operation.id));
    const deferred: DispatchSchedulingOperation[] = [];
    let progressed = false;

    for (const operation of remaining) {
      const predecessorId = operation.predecessorOperationId ?? null;
      if (predecessorId && !knownOperationEnd.has(predecessorId)) {
        if (remainingIds.has(predecessorId)) {
          deferred.push(operation);
          continue;
        }
        skipped.push({
          operationId: operation.id,
          orderId: operation.orderId,
          operationName: operation.operationName,
          reason: "previous material pass has no Dispatch slot",
        });
        progressed = true;
        continue;
      }

      let candidates: DispatchSchedulingMachine[] = [];
      if (operation.machineId) {
        const assigned = machineById.get(operation.machineId);
        if (assigned) candidates = [assigned];
      } else if (operation.automaticMachine !== false) {
        const required = String(operation.requiredMachineCategory ?? "").trim();
        candidates = required
          ? input.machines.filter((machine) => categoryMatches(machine.category, required))
          : input.machines.slice();
      }
      candidates = candidates.filter(available);

      if (candidates.length === 0) {
        skipped.push({
          operationId: operation.id,
          orderId: operation.orderId,
          operationName: operation.operationName,
          reason: operation.machineId
            ? "assigned machine is unavailable"
            : operation.automaticMachine === false
              ? "exact machine is not assigned"
              : `no active ${operation.requiredMachineCategory || "compatible"} machine`,
        });
        progressed = true;
        continue;
      }

      const durationMs = Math.max(1, Number(operation.estimatedMinutes) || 60) * 60_000;
      const earliest = Math.max(
        nowMs,
        predecessorId ? (knownOperationEnd.get(predecessorId) ?? nowMs) : nowMs,
      );
      let chosen = candidates[0];
      let startMs = Number.MAX_SAFE_INTEGER;
      for (const machine of candidates) {
        const candidateStart = earliestGap(busyByMachine.get(machine.id) ?? [], earliest, durationMs);
        if (candidateStart < startMs || (candidateStart === startMs && machine.id < chosen.id)) {
          chosen = machine;
          startMs = candidateStart;
        }
      }
      const endMs = startMs + durationMs;
      placements.push({
        operationId: operation.id,
        orderId: operation.orderId,
        operationName: operation.operationName,
        expectedMachineId: operation.machineId,
        machineId: chosen.id,
        startMs,
        endMs,
      });
      busyByMachine.set(chosen.id, [
        ...(busyByMachine.get(chosen.id) ?? []),
        [startMs, endMs],
      ]);
      knownOperationEnd.set(operation.id, endMs);
      progressed = true;
    }

    if (deferred.length === 0) break;
    if (!progressed) {
      for (const operation of deferred) {
        skipped.push({
          operationId: operation.id,
          orderId: operation.orderId,
          operationName: operation.operationName,
          reason: "previous material pass has no Dispatch slot",
        });
      }
      break;
    }
    remaining = deferred;
  }

  return { attempted: pending.length, placements, skipped };
}
