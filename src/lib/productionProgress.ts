function acceptedReceiptQuantity(lots: readonly { quantity: number }[]): number {
  return lots.reduce((total, lot) => {
    const quantity = Number(lot.quantity);
    return total + (Number.isSafeInteger(quantity) && quantity > 0 ? quantity : 0);
  }, 0);
}

export interface TrackedProductionLot {
  materialId: number;
  quantityUsed: number;
  receiptLotId?: string;
  steps: { operationId: number }[];
}

export interface RequestedProductionMaterial {
  id: number;
  quantityUsed: number;
}

export interface ProductionOperationState {
  id: number;
  status: string;
}

/**
 * Progress for receipt-tracked orders is quantity-weighted across every route
 * pass. Unreceived demand stays in the denominator and can never be complete.
 */
export function calculateReceiptTrackedProgress(input: {
  materials: readonly RequestedProductionMaterial[];
  planItems: readonly TrackedProductionLot[];
  operationStates: readonly ProductionOperationState[];
  receiptLots: Record<string, readonly { quantity: number }[]>;
}): { progressPercent: number; canComplete: boolean; acceptedQuantity: number; requestedQuantity: number } {
  const operationStatus = new Map(input.operationStates.map((operation) => [operation.id, operation.status]));
  const routeLengthByMaterial = new Map<number, number>();
  for (const item of input.planItems) {
    if (item.steps.length > 0 && !routeLengthByMaterial.has(item.materialId)) {
      routeLengthByMaterial.set(item.materialId, item.steps.length);
    }
  }

  let requestedQuantity = 0;
  let acceptedQuantity = 0;
  let materialsReceived = true;
  let planCoversDemand = true;
  let requiredWork = 0;
  for (const material of input.materials) {
    const requested = Math.max(0, Math.floor(Number(material.quantityUsed) || 0));
    const accepted = acceptedReceiptQuantity(input.receiptLots[String(material.id)] ?? []);
    requestedQuantity += requested;
    acceptedQuantity += accepted;
    if (accepted < requested) materialsReceived = false;

    const routeLength = routeLengthByMaterial.get(material.id) ?? 0;
    const plannedLotQuantity = input.planItems
      .filter((item) => item.materialId === material.id && item.receiptLotId)
      .reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.quantityUsed) || 0)), 0);
    if (routeLength === 0 || plannedLotQuantity < requested) planCoversDemand = false;
    requiredWork += requested * routeLength;
  }

  const lots = input.planItems.filter((item) => Boolean(item.receiptLotId));
  let completedWork = 0;
  let everyLotComplete = lots.length > 0;
  for (const lot of lots) {
    const quantity = Math.max(0, Math.floor(Number(lot.quantityUsed) || 0));
    if (lot.steps.length === 0 || lot.steps.some((step) => operationStatus.get(step.operationId) !== "Completed")) {
      everyLotComplete = false;
    }
    for (const step of lot.steps) {
      if (operationStatus.get(step.operationId) === "Completed") completedWork += quantity;
    }
  }

  const canComplete = input.materials.length > 0
    && materialsReceived
    && planCoversDemand
    && everyLotComplete;
  let progressPercent = requiredWork > 0
    ? Math.min(100, Math.round((completedWork / requiredWork) * 100))
    : 0;
  // Rounding must not display 100% while even one accepted/requested unit or
  // one route pass remains outstanding.
  if (!canComplete && progressPercent >= 100) progressPercent = 99;
  return { progressPercent, canComplete, acceptedQuantity, requestedQuantity };
}
