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
  preparedQty?: number | null;
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

/** Prepared quantity, preserving old rows where Prepared meant the whole line. */
export function preparedQty(line: BomLineLike): number {
  const total = Math.max(0, Math.floor(Number(line.quantityUsed) || 0));
  if (line.status === "Delivered") return total;
  if (line.preparedQty != null) return Math.max(sentQty(line), clampDeliveredQty(line.preparedQty, total));
  return line.status === "Prepared" ? total : sentQty(line);
}

/** Human-facing state for the separate preparation and delivery tallies. */
export function fulfilmentLabel(line: BomLineLike): string {
  const total = Math.max(0, Math.floor(Number(line.quantityUsed) || 0));
  const prepared = preparedQty(line);
  const sent = sentQty(line);
  if (total > 0 && sent >= total) return "Delivered";
  if (sent > 0 && prepared < total) return "Partially prepared & sent";
  if (sent > 0) return "Partially delivered";
  if (prepared >= total && total > 0) return "Prepared";
  if (prepared > 0) return "Partially prepared";
  return "Requested";
}

export type BomQuantityAction = "prepare" | "send";

export type BomQuantityActionResult =
  | { ok: true; preparedQty: number; deliveredQty: number; status: "Requested" | "Prepared" | "Delivered" }
  | { ok: false; error: string };

/** Add a quantity to the prepared or sent tally, enforcing prepare-before-send. */
export function applyBomQuantityAction(
  line: BomLineLike,
  action: BomQuantityAction,
  additionalQuantity: unknown,
): BomQuantityActionResult {
  const total = Math.max(0, Math.floor(Number(line.quantityUsed) || 0));
  const prepared = preparedQty(line);
  const sent = sentQty(line);
  const amount = Number(additionalQuantity);
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, error: "Enter a positive whole quantity." };
  if (action === "prepare") {
    const remaining = total - prepared;
    if (amount > remaining) return { ok: false, error: `Only ${remaining} more unit(s) remain to prepare.` };
    const nextPrepared = prepared + amount;
    return { ok: true, preparedQty: nextPrepared, deliveredQty: sent, status: nextPrepared >= total && sent >= total ? "Delivered" : nextPrepared > 0 ? "Prepared" : "Requested" };
  }
  const readyToSend = prepared - sent;
  if (amount > readyToSend) return { ok: false, error: `Only ${readyToSend} prepared unit(s) remain to send.` };
  const nextSent = sent + amount;
  return { ok: true, preparedQty: prepared, deliveredQty: nextSent, status: nextSent >= total && total > 0 ? "Delivered" : prepared > 0 ? "Prepared" : "Requested" };
}

/** Status a line should carry after recording `qty` sent units. */
export function statusAfterPartial(qty: number, lineQty: number): "Prepared" | "Delivered" {
  return qty >= Math.max(0, Math.floor(Number(lineQty) || 0)) && qty > 0 ? "Delivered" : "Prepared";
}
