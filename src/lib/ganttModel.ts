// ============================================================================
// Gantt model — pure, framework-free helpers for the daily order timeline and
// the Deadline Health board. No server imports, no React: every function is
// unit-testable from render-test.js.
//
// A "candle" spans an order from its issue date (createdAt) to its due date,
// or to the actual delivery date once the order is delivered. Operation steps
// are placed at their TRUE calendar dates: actual start/endTime when present,
// otherwise scheduledStart/scheduledEnd. Steps without any date stay
// "unscheduled" and are surfaced as counts, never invented on the timeline.
// ============================================================================

export const DAY_MS = 86_400_000;

export function startOfDayMs(value: string | number | Date): number {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDayMs(value: string | number | Date): number {
  return startOfDayMs(value) + DAY_MS - 1;
}

export interface GanttStep {
  id: number;
  stepOrder: number;
  operationName: string;
  status: string;
  machineCode: string | null;
  machineCategory?: string | null;
  estimatedMinutes: number | null;
  scheduledStart: string | null;
  scheduledEnd: string | null;
  startTime: string | null;
  endTime: string | null;
  batchId: number | null;
  batchName: string | null;
  batchNumber: number | null;
}

export interface GanttDispatch {
  stage: string | null;
  mixed: boolean;
  deliveredCount: number;
  totalBatches: number;
  deliveredAt: string | null;
}

export interface GanttOrder {
  id: number;
  orderNumber: string;
  title: string;
  customerLabel: string;
  projectType: string | null;
  priority: string;
  status: string;
  createdAt: string;
  dueDate: string;
  progressPercent: number;
  totalValue: string | null;
  totalSteps: number;
  completedSteps: number;
  dispatch: GanttDispatch;
  steps: GanttStep[];
}

export interface TimelineWindow {
  startMs: number;
  endMs: number;
}

export interface StepWindow {
  startMs: number;
  endMs: number;
  kind: "actual" | "scheduled";
}

export type HealthBucket = "on-track" | "at-risk" | "overdue" | "ready" | "delivered";

export const HEALTH_COLUMNS: { id: HealthBucket; title: string }[] = [
  { id: "on-track", title: "On Track" },
  { id: "at-risk", title: "At Risk" },
  { id: "overdue", title: "Overdue" },
  { id: "ready", title: "Ready for Delivery" },
  { id: "delivered", title: "Recently Delivered" },
];

/** Orders still inside the production/delivery loop. */
export function isOrderOpen(order: GanttOrder): boolean {
  return order.status !== "Delivered" && order.status !== "Cancelled";
}

/** True when every routed step of the order is finished (or the order says so). */
export function isWorkComplete(order: GanttOrder): boolean {
  if (order.status === "Completed" || order.status === "Delivered") return true;
  return order.totalSteps > 0 && order.completedSteps >= order.totalSteps;
}

/** True when the parent order is delivered (status roll-up or all batches delivered). */
export function isDeliveredOrder(order: GanttOrder): boolean {
  if (order.status === "Delivered") return true;
  return order.dispatch.totalBatches > 0 && order.dispatch.deliveredCount >= order.dispatch.totalBatches;
}

/**
 * Real calendar window of one operation. Actual execution dates win over the
 * plan; a step with neither is unscheduled (returns null) so the UI can flag
 * it instead of inventing a position.
 */
export function stepWindow(step: GanttStep): StepWindow | null {
  const s = step.startTime ? new Date(step.startTime).getTime() : NaN;
  const e = step.endTime ? new Date(step.endTime).getTime() : NaN;
  if (Number.isFinite(s) && Number.isFinite(e) && e >= s) {
    return { startMs: s, endMs: e, kind: "actual" };
  }
  const ss = step.scheduledStart ? new Date(step.scheduledStart).getTime() : NaN;
  const se = step.scheduledEnd ? new Date(step.scheduledEnd).getTime() : NaN;
  if (Number.isFinite(ss) && Number.isFinite(se) && se >= ss) {
    return { startMs: ss, endMs: se, kind: "scheduled" };
  }
  return null;
}

/** Candle span: issue date → due date, or → actual delivery date once delivered. */
export function orderSpan(order: GanttOrder): {
  startMs: number;
  endMs: number;
  dueMs: number;
  deliveredMs: number | null;
} {
  const startMs = startOfDayMs(order.createdAt);
  const dueMs = endOfDayMs(order.dueDate);
  const deliveredMs =
    isDeliveredOrder(order) && order.dispatch.deliveredAt
      ? endOfDayMs(order.dispatch.deliveredAt)
      : null;
  let endMs = deliveredMs ?? dueMs;
  if (endMs < startMs) endMs = startMs + DAY_MS - 1;
  return { startMs, endMs, dueMs, deliveredMs };
}

/**
 * Auto-fit window for the timeline: earliest issue date to the latest due or
 * delivery date of the supplied orders, padded one day on each side. Steps
 * scheduled beyond the due date extend the window so plan-overdue stays
 * visible. Falls back to a week around "now" when the list is empty and is
 * capped at 366 days.
 */
export function computeTimelineWindow(orders: GanttOrder[], now: number): TimelineWindow {
  let lo: number | null = null;
  let hi: number | null = null;
  const consider = (ms: number) => {
    if (!Number.isFinite(ms)) return;
    if (lo === null || ms < lo) lo = ms;
    if (hi === null || ms > hi) hi = ms;
  };
  for (const order of orders) {
    if (order.status === "Cancelled") continue;
    const created = startOfDayMs(order.createdAt);
    const span = orderSpan(order);
    consider(span.startMs);
    consider(span.endMs);
    if (isOrderOpen(order)) {
      for (const step of order.steps) {
        const w = stepWindow(step);
        if (w) {
          consider(w.startMs);
          consider(w.endMs);
        }
      }
    }
  }
  const nowDay = startOfDayMs(now);
  if (lo === null || hi === null) {
    lo = nowDay - 3 * DAY_MS;
    hi = nowDay + 4 * DAY_MS;
  }
  let startMs = (lo as number) - DAY_MS;
  let endMs = (hi as number) + DAY_MS;
  if (endMs - startMs > 366 * DAY_MS) endMs = startMs + 366 * DAY_MS - 1;
  return { startMs, endMs };
}

/** One entry per day inside the window (local midnight timestamps). */
export function buildDays(window: TimelineWindow): number[] {
  const days: number[] = [];
  let t = startOfDayMs(window.startMs);
  const lastDay = startOfDayMs(window.endMs);
  while (t <= lastDay) {
    days.push(t);
    t += DAY_MS;
  }
  return days;
}

/**
 * Greedy interval lane assignment: each window gets the lowest lane whose
 * previous bar has ended (end <= start). Returns -1 for unscheduled entries
 * in the same order as the input.
 */
export function assignLanes(windows: (StepWindow | null)[]): number[] {
  const laneEnds: number[] = [];
  return windows.map((w) => {
    if (!w) return -1;
    for (let i = 0; i < laneEnds.length; i++) {
      if (laneEnds[i] <= w.startMs) {
        laneEnds[i] = w.endMs;
        return i;
      }
    }
    laneEnds.push(w.endMs);
    return laneEnds.length - 1;
  });
}

export function maxLanes(lanes: number[]): number {
  return lanes.reduce((m, l) => (l >= 0 ? Math.max(m, l + 1) : m), 0);
}

/** Whole-day distance from "now" to the due date (negative = past due). */
export function daysToDue(order: GanttOrder, now: number): number {
  return Math.round((startOfDayMs(order.dueDate) - startOfDayMs(now)) / DAY_MS);
}

/**
 * Open (non-completed) steps that have no date at all. Completed steps are
 * never "unscheduled work" — a missing historical timestamp is not a risk.
 */
export function unscheduledStepCount(order: GanttOrder): number {
  return order.steps.filter((s) => s.status !== "Completed" && !stepWindow(s)).length;
}

/** First non-completed step in route order — the work that happens next. */
export function nextOpenStep(order: GanttOrder): GanttStep | null {
  const open = order.steps.filter((s) => s.status !== "Completed");
  if (open.length === 0) return null;
  return open.slice().sort((a, b) => a.stepOrder - b.stepOrder || a.id - b.id)[0];
}

/** Any scheduled/actual work that ends after the due date. */
export function scheduleCrossesDue(order: GanttOrder): boolean {
  if (!isOrderOpen(order)) return false;
  const dueEnd = endOfDayMs(order.dueDate);
  return order.steps.some((s) => {
    const w = stepWindow(s);
    return Boolean(w && w.endMs > dueEnd);
  });
}

export function recentlyDelivered(order: GanttOrder, now: number, withinDays = 14): boolean {
  if (!isDeliveredOrder(order)) return false;
  if (!order.dispatch.deliveredAt) return true; // legacy delivery without proof stamp
  return startOfDayMs(order.dispatch.deliveredAt) >= startOfDayMs(now) - (withinDays - 1) * DAY_MS;
}

/**
 * Deadline health bucketing:
 *  - delivered: order fully delivered (the board keeps only the last 14 days).
 *  - ready: production complete, delivery still to do — even when past due,
 *    because the remaining action is dispatch, not shop-floor work.
 *  - overdue: past due with work still open.
 *  - at-risk: due within 7 days with under 50% progress or unscheduled steps.
 *  - on-track: everything else.
 */
export function healthBucket(order: GanttOrder, now: number): HealthBucket {
  if (isDeliveredOrder(order)) return "delivered";
  const d = daysToDue(order, now);
  if (isWorkComplete(order)) return "ready";
  if (d < 0) return "overdue";
  if (d <= 7 && (order.progressPercent < 50 || unscheduledStepCount(order) > 0)) return "at-risk";
  return "on-track";
}
