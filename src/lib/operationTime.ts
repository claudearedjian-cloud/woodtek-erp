// Pure timing ledger for operation execution/pause durations. The order_operations
// row keeps its existing actualMinutes field; this sidecar preserves precise
// intervals without requiring a database migration on schema-drifted installs.

export interface OperationTimeEntry {
  startedAt: string;
  executionSeconds: number;
  pausedSeconds: number;
  activeSince: string | null;
  pausedSince: string | null;
  completedAt: string | null;
  /** False when this operation was already underway before detailed tracking. */
  historyComplete: boolean;
}

export interface OperationTimeSummary {
  startedAt: string | null;
  executionSeconds: number;
  pausedSeconds: number;
  totalSeconds: number;
  activeSince: string | null;
  pausedSince: string | null;
  completedAt: string | null;
  snapshotAt: string;
  historyComplete: boolean;
}

export interface LegacyTimingFallback {
  startTime?: Date | string | null;
  updatedAt?: Date | string | null;
  endTime?: Date | string | null;
  actualMinutes?: number | null;
}

function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function secondsBetween(start: string | null, end: string): number {
  if (!start) return 0;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, Math.floor((b - a) / 1000)) : 0;
}

function seedLegacy(previousStatus: string, at: string, fallback?: LegacyTimingFallback): OperationTimeEntry | null {
  const oldStart = isoOrNull(fallback?.startTime);
  if (!oldStart && previousStatus !== "Paused" && previousStatus !== "Rejected/Rework") return null;
  const paused = previousStatus === "Paused" || previousStatus === "Rejected/Rework";
  return {
    startedAt: oldStart ?? at,
    executionSeconds: Math.max(0, Math.floor(Number(fallback?.actualMinutes) || 0) * 60),
    pausedSeconds: 0,
    activeSince: paused ? null : oldStart,
    pausedSince: paused ? (isoOrNull(fallback?.updatedAt) ?? at) : null,
    completedAt: null,
    historyComplete: false,
  };
}

/** Apply one successful database status transition to the precise sidecar. */
export function advanceOperationTime(
  existing: OperationTimeEntry | null,
  previousStatus: string,
  nextStatus: string,
  transitionAt: Date | string,
  fallback?: LegacyTimingFallback,
): OperationTimeEntry | null {
  const at = isoOrNull(transitionAt);
  if (!at || previousStatus === nextStatus) return existing;

  if (nextStatus === "In Progress") {
    if (previousStatus === "Completed" || existing?.completedAt) {
      return {
        startedAt: at,
        executionSeconds: 0,
        pausedSeconds: 0,
        activeSince: at,
        pausedSince: null,
        completedAt: null,
        historyComplete: true,
      };
    }
    const entry = existing ?? seedLegacy(previousStatus, at, fallback);
    if (!entry) {
      return {
        startedAt: at,
        executionSeconds: 0,
        pausedSeconds: 0,
        activeSince: at,
        pausedSince: null,
        completedAt: null,
        historyComplete: true,
      };
    }
    const pauseSeconds = secondsBetween(entry.pausedSince, at);
    return {
      ...entry,
      pausedSeconds: entry.pausedSeconds + pauseSeconds,
      activeSince: at,
      pausedSince: null,
      completedAt: null,
    };
  }

  const entry = existing ?? seedLegacy(previousStatus, at, fallback);
  if (!entry) return null;

  if (nextStatus === "Paused" || nextStatus === "Rejected/Rework") {
    return {
      ...entry,
      executionSeconds: entry.executionSeconds + secondsBetween(entry.activeSince, at),
      activeSince: null,
      pausedSince: entry.pausedSince ?? at,
      completedAt: null,
    };
  }

  if (nextStatus === "Completed") {
    return {
      ...entry,
      executionSeconds: entry.executionSeconds + secondsBetween(entry.activeSince, at),
      pausedSeconds: entry.pausedSeconds + secondsBetween(entry.pausedSince, at),
      activeSince: null,
      pausedSince: null,
      completedAt: at,
    };
  }

  if (nextStatus === "Ready" || nextStatus === "Pending") {
    return {
      ...entry,
      executionSeconds: entry.executionSeconds + secondsBetween(entry.activeSince, at),
      activeSince: null,
      pausedSince: entry.pausedSince ?? (entry.startedAt ? at : null),
      completedAt: null,
    };
  }

  return entry;
}

/** Build a live snapshot for the station UI; intervals remain exact to seconds. */
export function summarizeOperationTime(
  entry: OperationTimeEntry | null,
  status: string,
  fallback: LegacyTimingFallback = {},
  now: Date | string = new Date(),
): OperationTimeSummary {
  const snapshotAt = isoOrNull(now) ?? new Date().toISOString();
  if (entry) {
    const liveExecution = secondsBetween(entry.activeSince, snapshotAt);
    const livePause = secondsBetween(entry.pausedSince, snapshotAt);
    const started = new Date(entry.startedAt).getTime();
    const finished = entry.completedAt ? new Date(entry.completedAt).getTime() : new Date(snapshotAt).getTime();
    return {
      startedAt: entry.startedAt,
      executionSeconds: entry.executionSeconds + liveExecution,
      pausedSeconds: entry.pausedSeconds + livePause,
      totalSeconds: Number.isFinite(started) && Number.isFinite(finished) ? Math.max(0, Math.floor((finished - started) / 1000)) : 0,
      activeSince: entry.activeSince,
      pausedSince: entry.pausedSince,
      completedAt: entry.completedAt,
      snapshotAt,
      historyComplete: entry.historyComplete,
    };
  }

  const start = isoOrNull(fallback.startTime);
  const end = isoOrNull(fallback.endTime);
  const updated = isoOrNull(fallback.updatedAt);
  const running = status === "In Progress" && start;
  const paused = status === "Paused" && updated;
  const executionSeconds = Math.max(0, Math.floor(Number(fallback.actualMinutes) || 0) * 60)
    + (running ? secondsBetween(start, snapshotAt) : 0);
  const pausedSeconds = paused ? secondsBetween(updated, snapshotAt) : 0;
  return {
    startedAt: start,
    executionSeconds,
    pausedSeconds,
    totalSeconds: executionSeconds + pausedSeconds,
    activeSince: running ? start : null,
    pausedSince: paused ? updated : null,
    completedAt: end,
    snapshotAt,
    historyComplete: false,
  };
}
