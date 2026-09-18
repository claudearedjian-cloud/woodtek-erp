// ============================================================================
// Multi-machine candidates for one logical production operation — pure helpers.
//
// Before work begins, one operation may be offered to several equivalent
// stations. The first valid Start claims exactly one station; running and
// completed work always resolves to the persisted database machine.
// ============================================================================

export const CANDIDATE_CLAIMABLE_STATUSES = ["Pending", "Ready"] as const;

export interface OperationMachineCandidateEntry {
  machineIds: number[];
  updatedAt?: string;
  updatedById?: number;
}

export type OperationMachineCandidateMap = Record<string, OperationMachineCandidateEntry>;

export function sanitizeCandidateMachineIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const value of raw) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 24) break;
  }
  return out;
}

export function candidateStatusIsClaimable(status: string | null | undefined): boolean {
  return (CANDIDATE_CLAIMABLE_STATUSES as readonly string[]).includes(String(status ?? ""));
}

/**
 * Effective candidates shown to clients. A stale multi-candidate overlay can
 * never fan running/completed work back out to other stations: once the status
 * is no longer pre-start, only the database machine remains effective.
 */
export function effectiveCandidateMachineIds(
  persistedMachineId: number | null | undefined,
  status: string | null | undefined,
  entry: OperationMachineCandidateEntry | null | undefined,
): number[] {
  const persisted = Number(persistedMachineId);
  const fallback = Number.isInteger(persisted) && persisted > 0 ? [persisted] : [];
  if (!candidateStatusIsClaimable(status)) return fallback;
  const candidates = sanitizeCandidateMachineIds(entry?.machineIds);
  return candidates.length > 0 ? candidates : fallback;
}

export function candidateIncludesStation(
  persistedMachineId: number | null | undefined,
  status: string | null | undefined,
  entry: OperationMachineCandidateEntry | null | undefined,
  stationMachineId: number,
): boolean {
  return effectiveCandidateMachineIds(persistedMachineId, status, entry).includes(Number(stationMachineId));
}

/** Grey "taken at another station" cards stay visible for this window. */
export const CLAIMED_ELSEWHERE_GRACE_MS = 10 * 60 * 1000;

/**
 * Machine categories are manager-editable free text, so all comparisons are
 * trimmed + case-insensitive. A missing category cannot disqualify a machine
 * (unknown data never blocks; an explicit different category still does).
 */
export function normalizeMachineCategory(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function machineCategoryMatches(stepCategory: unknown, machineCategory: unknown): boolean {
  const step = normalizeMachineCategory(stepCategory);
  const machine = normalizeMachineCategory(machineCategory);
  if (!step || !machine) return true;
  return step === machine;
}

/** When the work actually started, falling back to the last update stamp. */
export function claimedElsewhereStartMs(
  startedAt: string | number | Date | null | undefined,
  updatedAt: string | number | Date | null | undefined,
): number | null {
  const s = startedAt ? new Date(startedAt).getTime() : NaN;
  if (Number.isFinite(s)) return s;
  const u = updatedAt ? new Date(updatedAt).getTime() : NaN;
  if (Number.isFinite(u)) return u;
  return null;
}

/**
 * Whether a "taken elsewhere" card should still be visible: the work must
 * have started within the last graceMs (a small forward allowance absorbs
 * clock skew between the server and the wall).
 */
export function isWithinClaimedElsewhereGrace(
  startedAt: string | number | Date | null | undefined,
  updatedAt: string | number | Date | null | undefined,
  nowMs: number,
  graceMs: number = CLAIMED_ELSEWHERE_GRACE_MS,
): boolean {
  const at = claimedElsewhereStartMs(startedAt, updatedAt);
  if (at === null) return false;
  return at >= nowMs - graceMs && at <= nowMs + 60_000;
}
