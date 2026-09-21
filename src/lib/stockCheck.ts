// ============================================================================
// Stock check at order issue — pure model, no framework imports.
//
// When an order is issued its BOM lines become reservations automatically
// (orderMaterials rows count in computeAvailability), but nothing told the
// user at issue time whether a line would go SHORT or drop stock below the
// reorder point. This module classifies each line from a pre-issue snapshot:
//   short          -> requested > (stock - reservations by OTHER orders)
//   below-reorder  -> after this order's commitment, remaining < reorderLevel
//   ok             -> otherwise (no warning)
// Reservations remain a VISIBILITY/commitment aid: physical stock is still
// reconciled by the owner (Excel import) and debited by the existing
// consume/release lifecycle (Completed / On Hold / Cancelled).
// ============================================================================

export interface StockCheckLineInput {
  sku: string;
  name: string;
  quantity: number;
  stockQuantity: number;
  /** Units already reserved by other orders before this issue. */
  reservedBefore: number;
  reorderLevel: number;
}

export type StockCheckStatus = "short" | "below-reorder" | "ok";

export interface StockCheckLine {
  sku: string;
  name: string;
  quantity: number;
  availableBefore: number;
  availableAfter: number;
  reorderLevel: number;
  status: StockCheckStatus;
  message: string | null;
}

export interface StockCheckSummary {
  warnings: string[];
  lines: StockCheckLine[];
}

const whole = (value: number) => Math.max(0, Math.floor(Number(value) || 0));

export function evaluateStockLine(input: StockCheckLineInput): StockCheckLine {
  const quantity = whole(input.quantity);
  const stock = whole(input.stockQuantity);
  const reservedBefore = whole(input.reservedBefore);
  const reorderLevel = whole(input.reorderLevel);
  const availableBefore = Math.max(0, stock - reservedBefore);
  const availableAfter = Math.max(0, stock - reservedBefore - quantity);

  let status: StockCheckStatus = "ok";
  let message: string | null = null;
  if (quantity > availableBefore) {
    status = "short";
    message =
      `Need ${quantity}, only ${availableBefore} available ` +
      `(stock ${stock}${reservedBefore > 0 ? `, ${reservedBefore} reserved by other orders` : ""}) ` +
      `— short by ${quantity - availableBefore}`;
  } else if (reorderLevel > 0 && availableAfter < reorderLevel) {
    status = "below-reorder";
    message = `Will drop below the reorder point (${availableAfter} left, reorder at ${reorderLevel})`;
  }

  return {
    sku: input.sku,
    name: input.name,
    quantity,
    availableBefore,
    availableAfter,
    reorderLevel,
    status,
    message,
  };
}

/** Warnings carry the SKU prefix so the alert is scannable: "MDF-18: …". */
export function stockCheckSummary(lines: readonly StockCheckLine[]): StockCheckSummary {
  return {
    warnings: lines
      .filter((line) => line.status !== "ok" && line.message)
      .map((line) => `${line.sku || line.name}: ${line.message}`),
    lines: Array.from(lines),
  };
}
