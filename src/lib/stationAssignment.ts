// Pure assignment-set reconciliation for Operator Station.
// The previous UI remembered only the first matching machine, so adding a
// second assignment could leave the first id unchanged and silently miss the
// supervisor's update. Reconcile the complete set instead.

export type StationSelectionReason =
  | "unchanged"
  | "initial-assignment"
  | "assignment-added"
  | "selection-removed"
  | "fallback";

export interface StationSelectionInput {
  availableMachineIds: Array<number | string | null | undefined>;
  assignedMachineIds: Array<number | string | null | undefined>;
  previousAssignedMachineIds: Array<number | string | null | undefined>;
  selectedMachineId: number | null;
  initialized: boolean;
}

export interface StationSelectionResult {
  selectedMachineId: number | null;
  reason: StationSelectionReason;
  addedMachineIds: number[];
  removedMachineIds: number[];
}

export function uniquePositiveMachineIds(values: Array<number | string | null | undefined>): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of values) {
    const id = Number(value);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function reconcileStationSelection(input: StationSelectionInput): StationSelectionResult {
  const available = uniquePositiveMachineIds(input.availableMachineIds);
  const availableSet = new Set(available);
  const assigned = uniquePositiveMachineIds(input.assignedMachineIds).filter((id) => availableSet.has(id));
  const previous = uniquePositiveMachineIds(input.previousAssignedMachineIds);
  const assignedSet = new Set(assigned);
  const previousSet = new Set(previous);
  const addedMachineIds = assigned.filter((id) => !previousSet.has(id));
  const removedMachineIds = previous.filter((id) => !assignedSet.has(id));
  const selectedIsAvailable = input.selectedMachineId != null && availableSet.has(input.selectedMachineId);

  if (!input.initialized) {
    const selectedMachineId = assigned[0]
      ?? (selectedIsAvailable ? input.selectedMachineId : null)
      ?? available[0]
      ?? null;
    return {
      selectedMachineId,
      reason: assigned.length > 0 ? "initial-assignment" : "fallback",
      addedMachineIds,
      removedMachineIds,
    };
  }

  // Most assignment edits affect one machine. Choosing the newly added member
  // makes an add/move visible immediately even when an older assignment sorts
  // first. If several were added in one save, all still appear in the selector
  // and the first deterministic roster member becomes active.
  if (addedMachineIds.length > 0) {
    return {
      selectedMachineId: addedMachineIds[0],
      reason: "assignment-added",
      addedMachineIds,
      removedMachineIds,
    };
  }

  if (!selectedIsAvailable) {
    return {
      selectedMachineId: assigned[0] ?? available[0] ?? null,
      reason: "selection-removed",
      addedMachineIds,
      removedMachineIds,
    };
  }

  return {
    selectedMachineId: input.selectedMachineId,
    reason: "unchanged",
    addedMachineIds,
    removedMachineIds,
  };
}
