import assert from "node:assert/strict";
import { acceptedReceiptQuantity, availableReceiptQuantity, receiptQuantityFitsShipment } from "../src/lib/receiptLots.ts";
import { findProductionStepByOperation, productionLotIsReleased, productionPlanUsesReceiptTracking, sanitizeStoredOrderPlan } from "../src/lib/productionPlan.ts";
import { calculateReceiptTrackedProgress } from "../src/lib/productionProgress.ts";

const accepted = [{ quantity: 3 }];
assert.equal(acceptedReceiptQuantity(accepted), 3);
assert.equal(availableReceiptQuantity(4, accepted), 1, "one of four sent units remains available after accepting three");
assert.equal(receiptQuantityFitsShipment(1, 4, accepted), true);
assert.equal(receiptQuantityFitsShipment(2, 4, accepted), false, "cannot accept more than the warehouse sent");
assert.equal(availableReceiptQuantity(0, accepted), 0);
assert.equal(acceptedReceiptQuantity([{ quantity: 2.5 }, { quantity: -1 }, { quantity: 2 }]), 2, "invalid quantities do not inflate accepted counts");

const plan = sanitizeStoredOrderPlan({
  orderId: 71,
  createdAt: "2026-10-13T00:00:00.000Z",
  defaultSteps: [],
  items: [
    {
      materialId: 900,
      itemId: 44,
      name: "Cabinet panels",
      quantityUsed: 3,
      receiptLotId: "receipt-first",
      lotNumber: 1,
      routeSource: "custom",
      recipeName: "Panel route",
      steps: [
        { operationId: 101, position: 1, operationName: "BeamSaw1", machineCategory: "Saw", estimatedMinutes: 20 },
        { operationId: 102, position: 2, operationName: "Edge1", machineCategory: "Edgebander", estimatedMinutes: 30 },
      ],
    },
    {
      materialId: 900,
      itemId: 44,
      name: "Cabinet panels",
      quantityUsed: 1,
      receiptLotId: "receipt-second",
      lotNumber: 2,
      routeSource: "custom",
      recipeName: "Panel route",
      steps: [
        { operationId: 201, position: 1, operationName: "BeamSaw1", machineCategory: "Saw", estimatedMinutes: 20 },
        { operationId: 202, position: 2, operationName: "Edge1", machineCategory: "Edgebander", estimatedMinutes: 30 },
      ],
    },
  ],
});
assert.equal(plan?.items.length, 2, "each receipt remains its own production lot");
assert.equal(productionPlanUsesReceiptTracking(plan), true);
assert.equal(productionLotIsReleased(plan?.items[0]), true);
assert.equal(productionLotIsReleased({}), false, "unreceived remainder has no released production route");
assert.deepEqual(plan?.items.map((item) => item.quantityUsed), [3, 1]);
assert.equal(findProductionStepByOperation(plan, 101)?.item.receiptLotId, "receipt-first");
assert.equal(findProductionStepByOperation(plan, 201)?.item.receiptLotId, "receipt-second");
assert.notEqual(
  findProductionStepByOperation(plan, 102)?.item.steps[1].operationId,
  findProductionStepByOperation(plan, 202)?.item.steps[1].operationId,
  "later receipts have a distinct downstream operation chain",
);

const firstReceiptComplete = calculateReceiptTrackedProgress({
  materials: [{ id: 900, quantityUsed: 10 }],
  planItems: [{ materialId: 900, quantityUsed: 4, receiptLotId: "receipt-four", steps: [{ operationId: 301 }, { operationId: 302 }] }],
  operationStates: [{ id: 301, status: "Completed" }, { id: 302, status: "Completed" }],
  receiptLots: { 900: [{ quantity: 4 }] },
});
assert.equal(firstReceiptComplete.progressPercent, 40, "finishing a 4-piece lot cannot count the unreceived six pieces as complete");
assert.equal(firstReceiptComplete.canComplete, false, "an order remains open until all ten requested units have their own completed lot routes");

const bothReceiptsComplete = calculateReceiptTrackedProgress({
  materials: [{ id: 900, quantityUsed: 10 }],
  planItems: [
    { materialId: 900, quantityUsed: 4, receiptLotId: "receipt-four", steps: [{ operationId: 301 }, { operationId: 302 }] },
    { materialId: 900, quantityUsed: 6, receiptLotId: "receipt-six", steps: [{ operationId: 401 }, { operationId: 402 }] },
  ],
  operationStates: [
    { id: 301, status: "Completed" }, { id: 302, status: "Completed" },
    { id: 401, status: "Completed" }, { id: 402, status: "Completed" },
  ],
  receiptLots: { 900: [{ quantity: 4 }, { quantity: 6 }] },
});
assert.equal(bothReceiptsComplete.progressPercent, 100);
assert.equal(bothReceiptsComplete.canComplete, true, "order completion is restored after every requested quantity is received and processed");

console.log("Receipt-lot quantity and independent-chain tests passed.");
