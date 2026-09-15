// ============================================================================
// Partial BOM delivery — pure, client-safe helpers shared by the Warehouse
// board and the API. The delivered quantity itself lives in the JSON overlay
// (data/bom-status.json, BomStatusEntry.deliveredQty — no DB migration).
// A line counts as fully sent only when its overlay status is "Delivered",
// so the Floor Supervisor's reception gate is unchanged.
// ============================================================================

export interface BomLineLike {
  status: "Requested" | "Prepared" | "Delivered";
  quantityUsed: number;
  deliveredQty?: number | null;
}

/** Clamp a requested partial quantity to a sane integer within 0..lineQty. */
export function clampDeliveredQty(input: unknown, lineQty: number): number {
  const max = Math.max(0, Math.floor(Number(lineQty) || 0));
  const n = Math.floor(Number(input) || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, max);
}

/**
 * How many units have physically gone out to the floor:
 * a "Delivered" line is always fully sent; otherwise whatever partial
 * quantity the warehouse recorded while the line sits in "Prepared".
 */
export function sentQty(line: BomLineLike): number {
  if (line.status === "Delivered") return Math.max(0, Math.floor(Number(line.quantityUsed) || 0));
  return clampDeliveredQty(line.deliveredQty, line.quantityUsed);
}

/** Status a line should carry after recording `qty` sent units. */
export function statusAfterPartial(qty: number, lineQty: number): "Prepared" | "Delivered" {
  return qty >= Math.max(0, Math.floor(Number(lineQty) || 0)) && qty > 0 ? "Delivered" : "Prepared";
}
