// ============================================================================
// Station new-job alerts — pure model, no framework imports.
//
// The Operator Station already detects fresh queue arrivals (knownOpIds diff
// vs the previous poll). This module holds the decision + message shaping so
// the rule "never announce the initial queue" stays unit-tested.
// ============================================================================

export interface StationAlertRow {
  id: number;
  orderNumber?: string | null;
  operationName?: string | null;
}

/**
 * Rows that are NEW since the previous poll. Returns [] on the very first
 * poll (previousIds empty) so a user opening the station is not pinged for
 * jobs that were already waiting.
 */
export function newStationJobRows(
  previousIds: ReadonlySet<number>,
  rows: readonly StationAlertRow[],
): StationAlertRow[] {
  if (previousIds.size === 0) return [];
  return rows.filter((row) => {
    const id = Number(row.id);
    return Number.isFinite(id) && id > 0 && !previousIds.has(id);
  });
}

export function stationAlertTitle(count: number): string {
  return count === 1 ? "WoodTek — 1 new job" : `WoodTek — ${count} new jobs`;
}

/** One line per fresh job (max 4): "PO-0002/2026 · #1 Beam Saw Cutting". */
export function stationAlertBody(rows: readonly StationAlertRow[]): string {
  return rows
    .slice(0, 4)
    .map((row) => `${row.orderNumber || "Job"} · ${row.operationName || "New operation"}`)
    .join("\n");
}
