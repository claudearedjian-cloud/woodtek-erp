// ============================================================================
// Production & utilization report — pure model, no framework imports.
//
// Aggregates the user's scoped operation rows (via listOperationsForUser in
// the route) into a per-period production view:
//   - KPIs: completed jobs, live in-flight, actual vs planned hours,
//     on-time start rate, overdue scheduled jobs;
//   - per-machine table (full active roster, zero-activity machines included
//     so idle stations stay visible);
//   - operator ranking for the period.
//
// Semantics (kept deliberately simple and unit-testable):
//   - "completed" = status Completed AND endTime inside the period window;
//   - "started"   = startTime inside the period window (any status);
//   - on-time     = started within ON_TIME_GRACE_MS after scheduledStart;
//   - actual work = the actualMinutes column when set, else the
//     startTime→endTime span; planned work = estimatedMinutes;
//   - "overdue"   = still Pending/Ready at the window end with a
//     scheduledStart before it (a job that should already have started);
//     In Progress jobs are "in flight", not overdue.
// ============================================================================

export type ProductionRange = "today" | "yesterday" | "week" | "days7" | "month";

export interface ProductionRangeWindow {
  from: Date;
  to: Date;
  label: string;
}

/** A start within 15 minutes of the scheduled start counts as on time. */
export const ON_TIME_GRACE_MS = 15 * 60 * 1000;

const DAY_MS = 86_400_000;

export interface ProductionOpInput {
  id: number;
  orderId: number;
  operationName: string;
  status: string;
  estimatedMinutes: number;
  actualMinutes: number;
  machineId: number | null;
  machineCode: string | null;
  machineCategory: string | null;
  operatorId: number | null;
  operatorName: string | null;
  startTime: Date | null;
  endTime: Date | null;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
}

export interface ProductionMachineInput {
  id: number;
  code: string;
  name: string;
  category: string;
  status: string;
}

export interface ProductionMachineStats {
  machineId: number;
  code: string;
  name: string;
  category: string;
  status: string;
  completed: number;
  actualMinutes: number;
  plannedMinutes: number;
  started: number;
  onTimeStarts: number;
  inFlight: number;
  overdue: number;
  avgActualMinutes: number | null;
  avgEstimatedMinutes: number | null;
}

export interface ProductionOperatorStats {
  operatorId: number;
  name: string;
  completed: number;
  actualMinutes: number;
  started: number;
  onTimeStarts: number;
}

export interface ProductionKpis {
  completed: number;
  inProgress: number;
  started: number;
  actualMinutes: number;
  plannedMinutes: number;
  /** actual/planned for the completed jobs (1 = exactly as planned). */
  planCoverage: number | null;
  onTimeStarts: number;
  onTimeEligible: number;
  onTimeRate: number | null;
  overdue: number;
}

export interface ProductionReport {
  range: ProductionRange;
  label: string;
  from: string; // ISO
  to: string; // ISO
  kpis: ProductionKpis;
  machines: ProductionMachineStats[];
  operators: ProductionOperatorStats[];
}

export interface ProductionReportInput {
  ops: ProductionOpInput[];
  machines: ProductionMachineInput[];
  range: ProductionRange;
  now: Date;
}

/** Local-time window for a range. "week" starts on Sunday (business week). */
export function rangeWindow(range: ProductionRange, now: Date): ProductionRangeWindow {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  if (range === "today") {
    return { from: startOfToday, to: new Date(now), label: "Today" };
  }
  if (range === "yesterday") {
    const from = new Date(startOfToday.getTime() - DAY_MS);
    return { from, to: startOfToday, label: "Yesterday" };
  }
  if (range === "week") {
    const from = new Date(startOfToday);
    from.setDate(from.getDate() - from.getDay());
    return { from, to: new Date(now), label: "This week (Sun–)" };
  }
  if (range === "days7") {
    return { from: new Date(now.getTime() - 7 * DAY_MS), to: new Date(now), label: "Last 7 days" };
  }
  const from = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from, to: new Date(now), label: "This month" };
}

function inWindow(t: Date, from: Date, to: Date): boolean {
  return t >= from && t < to;
}

/** Actual work minutes: stored actuals win, then the start→end span, else 0. */
export function actualMinutesFor(op: ProductionOpInput): number {
  if (op.actualMinutes > 0) return op.actualMinutes;
  if (op.startTime && op.endTime && op.endTime > op.startTime) {
    return Math.max(1, Math.round((op.endTime.getTime() - op.startTime.getTime()) / 60000));
  }
  return 0;
}

interface Agg {
  completed: number;
  actualMinutes: number;
  plannedMinutes: number;
  started: number;
  onTimeStarts: number;
  onTimeEligible: number;
  inFlight: number;
  overdue: number;
}

const emptyAgg = (): Agg => ({
  completed: 0,
  actualMinutes: 0,
  plannedMinutes: 0,
  started: 0,
  onTimeStarts: 0,
  onTimeEligible: 0,
  inFlight: 0,
  overdue: 0,
});

export function buildProductionReport(input: ProductionReportInput): ProductionReport {
  const { from, to, label } = rangeWindow(input.range, input.now);
  const total = emptyAgg();
  const byMachine = new Map<number, Agg>();
  const byOperator = new Map<number, Agg & { name: string }>();

  for (const op of input.ops) {
    const completed =
      op.status === "Completed" && op.endTime != null && inWindow(op.endTime, from, to);
    const started = op.startTime != null && inWindow(op.startTime, from, to);
    const onTimeEligible = started && op.scheduledStart != null;
    const onTime =
      onTimeEligible && op.startTime! <= new Date(op.scheduledStart!.getTime() + ON_TIME_GRACE_MS);
    const inFlight = op.status === "In Progress";
    const overdue =
      (op.status === "Pending" || op.status === "Ready") &&
      op.scheduledStart != null &&
      op.scheduledStart < to;

    const track = (agg: Agg, count: boolean) => {
      if (completed && count) {
        agg.completed += 1;
        agg.actualMinutes += actualMinutesFor(op);
        agg.plannedMinutes += op.estimatedMinutes;
      }
      if (started && count) {
        agg.started += 1;
        if (onTimeEligible) {
          agg.onTimeEligible += 1;
          if (onTime) agg.onTimeStarts += 1;
        }
      }
      if (inFlight && count) agg.inFlight += 1;
      if (overdue && count) agg.overdue += 1;
    };

    track(total, true);
    if (op.machineId != null) {
      if (!byMachine.has(op.machineId)) byMachine.set(op.machineId, emptyAgg());
      track(byMachine.get(op.machineId)!, true);
    }
    if (op.operatorId != null && (completed || started)) {
      if (!byOperator.has(op.operatorId)) {
        byOperator.set(op.operatorId, {
          ...emptyAgg(),
          name: op.operatorName || `Operator #${op.operatorId}`,
        });
      }
      track(byOperator.get(op.operatorId)!, true);
    }
  }

  // Full roster: every machine appears, so idle stations stay visible.
  const machines: ProductionMachineStats[] = input.machines.map((m) => {
    const agg = byMachine.get(m.id) ?? emptyAgg();
    return {
      machineId: m.id,
      code: m.code,
      name: m.name,
      category: m.category,
      status: m.status,
      completed: agg.completed,
      actualMinutes: agg.actualMinutes,
      plannedMinutes: agg.plannedMinutes,
      started: agg.started,
      onTimeStarts: agg.onTimeStarts,
      inFlight: agg.inFlight,
      overdue: agg.overdue,
      avgActualMinutes: agg.completed > 0 ? Math.round(agg.actualMinutes / agg.completed) : null,
      avgEstimatedMinutes: agg.completed > 0 ? Math.round(agg.plannedMinutes / agg.completed) : null,
    };
  });
  machines.sort((a, b) => b.actualMinutes - a.actualMinutes || a.code.localeCompare(b.code));

  const operators: ProductionOperatorStats[] = Array.from(byOperator.entries())
    .map(([operatorId, agg]) => ({
      operatorId,
      name: agg.name,
      completed: agg.completed,
      actualMinutes: agg.actualMinutes,
      started: agg.started,
      onTimeStarts: agg.onTimeStarts,
    }))
    .sort((a, b) => b.completed - a.completed || b.actualMinutes - a.actualMinutes)
    .slice(0, 10);

  return {
    range: input.range,
    label,
    from: from.toISOString(),
    to: to.toISOString(),
    kpis: {
      completed: total.completed,
      inProgress: total.inFlight,
      started: total.started,
      actualMinutes: total.actualMinutes,
      plannedMinutes: total.plannedMinutes,
      planCoverage: total.plannedMinutes > 0 ? total.actualMinutes / total.plannedMinutes : null,
      onTimeStarts: total.onTimeStarts,
      onTimeEligible: total.onTimeEligible,
      onTimeRate: total.onTimeEligible > 0 ? total.onTimeStarts / total.onTimeEligible : null,
      overdue: total.overdue,
    },
    machines,
    operators,
  };
}
