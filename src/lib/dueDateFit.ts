// ============================================================================
// Due-date fit — pure model, no framework imports.
//
// Answers "will this order's production work finish by its due date?" from
// the order's operation rows alone:
//   - a scheduled pass contributes its scheduledEnd;
//   - a completed pass contributes its actual endTime;
//   - an in-progress pass is assumed to finish after "now";
//   - a waiting pass without a Dispatch slot is UNDETERMINED (its finish
//     depends on planning that has not happened yet).
//
// fits === false means the KNOWN work already overruns the due date (no
// planning can fix that). fits === null means it cannot be confirmed —
// usually because passes are still unscheduled.
// ============================================================================

export interface DueDateFitOperation {
  status: string;
  scheduledEnd?: Date | string | null;
  endTime?: Date | string | null;
}

export interface DueDateFitResult {
  hasDueDate: boolean;
  dueMs: number | null;
  /** Latest known finish across the order's passes; null when nothing is known. */
  plannedFinishMs: number | null;
  /** true = known work finishes on/before the due date; false = overrun; null = cannot confirm. */
  fits: boolean | null;
  /** plannedFinishMs - dueMs when the known work overruns; null otherwise. */
  overrunMs: number | null;
  unscheduledCount: number;
  hasInFlight: boolean;
  /** At least one completed pass finished after the due date (late already happened). */
  hasCompletedLate: boolean;
}

function timeMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  const result = parsed.getTime();
  return Number.isFinite(result) ? result : null;
}

export function evaluateDueDateFit(
  dueDate: Date | string | null | undefined,
  operations: readonly DueDateFitOperation[],
  nowMs: number = Date.now(),
): DueDateFitResult {
  const dueMs = timeMs(dueDate);
  let plannedFinishMs: number | null = null;
  let unscheduledCount = 0;
  let hasInFlight = false;
  let hasCompletedLate = false;

  for (const operation of operations) {
    const scheduledEnd = timeMs(operation.scheduledEnd);
    const actualEnd = timeMs(operation.endTime);
    let knownEnd: number | null;
    if (scheduledEnd !== null) {
      knownEnd = scheduledEnd;
    } else if (operation.status === "Completed") {
      knownEnd = actualEnd ?? nowMs;
      if (dueMs !== null && knownEnd > dueMs) hasCompletedLate = true;
    } else if (operation.status === "In Progress") {
      hasInFlight = true;
      knownEnd = actualEnd ?? nowMs;
      if (dueMs !== null && knownEnd > dueMs) hasCompletedLate = true;
    } else {
      // Waiting (Pending/Ready/Rejected-Rework) without a Dispatch slot.
      unscheduledCount += 1;
      knownEnd = null;
    }
    if (knownEnd !== null && (plannedFinishMs === null || knownEnd > plannedFinishMs)) {
      plannedFinishMs = knownEnd;
    }
  }

  if (dueMs === null) {
    return {
      hasDueDate: false,
      dueMs: null,
      plannedFinishMs,
      fits: null,
      overrunMs: null,
      unscheduledCount,
      hasInFlight,
      hasCompletedLate,
    };
  }

  if (plannedFinishMs !== null && plannedFinishMs > dueMs) {
    return {
      hasDueDate: true,
      dueMs,
      plannedFinishMs,
      fits: false,
      overrunMs: plannedFinishMs - dueMs,
      unscheduledCount,
      hasInFlight,
      hasCompletedLate,
    };
  }

  if (unscheduledCount > 0) {
    return {
      hasDueDate: true,
      dueMs,
      plannedFinishMs,
      fits: null,
      overrunMs: null,
      unscheduledCount,
      hasInFlight,
      hasCompletedLate,
    };
  }

  return {
    hasDueDate: true,
    dueMs,
    plannedFinishMs,
    fits: plannedFinishMs !== null ? true : null,
    overrunMs: null,
    unscheduledCount,
    hasInFlight,
    hasCompletedLate,
  };
}

/** "3d 4h" / "4h 20m" / "25m" for human-facing overrun text. */
export function formatOverrun(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  return `${minutes}m`;
}
