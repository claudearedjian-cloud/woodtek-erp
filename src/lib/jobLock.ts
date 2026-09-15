// ============================================================================
// Crew job lock — when several operators share one machine, the operator who
// STARTED a running job owns its controls; other crew members can still see
// the job but not start/stop/finish/reject it. Station Mode greys the buttons
// for locked-out crew mates; the operations API enforces the same rule for
// Machine-Operator-based roles (Manager / supervisors keep full control).
// ============================================================================

export interface JobLockOp {
  status?: string | null;
  operatorId?: number | string | null;
}

/**
 * True when THIS viewer may not control the job: it is running, someone
 * started it (operatorId recorded), and that someone is not the viewer.
 * Never locks managers/supervisors (viewerIsOperatorBased = false) and never
 * locks jobs with no recorded starter (any crew member may take over).
 */
export function jobLockedByOther(
  op: JobLockOp | null | undefined,
  viewerId: number | string | null | undefined,
  viewerIsOperatorBased: boolean,
): boolean {
  if (!viewerIsOperatorBased) return false;
  if (!op || op.status !== "In Progress") return false;
  const starter = op.operatorId;
  if (starter === null || starter === undefined || starter === "") return false;
  const a = Number(starter);
  const b = Number(viewerId);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a !== b;
}
