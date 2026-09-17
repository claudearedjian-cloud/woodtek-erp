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
