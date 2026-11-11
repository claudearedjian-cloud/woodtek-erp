import type { BomReceiptLot } from "@/lib/bomStatus.server";

/** Sum only valid, positive whole-unit receipt quantities. */
export function acceptedReceiptQuantity(lots: readonly Pick<BomReceiptLot, "quantity">[]): number {
  return lots.reduce((total, lot) => {
    const quantity = Number(lot.quantity);
    return total + (Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0);
  }, 0);
}

/** Sent units not yet accepted; a shipment discrepancy remains outside production. */
export function availableReceiptQuantity(
  sentQuantity: number,
  lots: readonly Pick<BomReceiptLot, "quantity">[],
): number {
  const sent = Number(sentQuantity);
  return Math.max(0, (Number.isSafeInteger(sent) && sent > 0 ? sent : 0) - acceptedReceiptQuantity(lots));
}

export function receiptQuantityFitsShipment(
  quantity: number,
  sentQuantity: number,
  lots: readonly Pick<BomReceiptLot, "quantity">[],
): boolean {
  return Number.isSafeInteger(quantity) && quantity > 0 && quantity <= availableReceiptQuantity(sentQuantity, lots);
}
