// ============================================================================
// Server storage for v2 production plans.
// File: <WOODTEK_DATA_DIR>/production-plans.json
// No database migration: the overlay links existing order-material and
// operation ids into independent per-material operation chains.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import {
  findProductionItemByMaterial,
  findProductionStepByOperation,
  sanitizeProductionPlanStore,
  type OrderProductionPlan,
  type PlannedProductionItem,
  type PlannedProductionStep,
  type ProductionPlanStore,
} from "@/lib/productionPlan";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "production-plans.json");
}

export function readProductionPlanStore(): ProductionPlanStore {
  try {
    return sanitizeProductionPlanStore(JSON.parse(fs.readFileSync(fileLocation(), "utf8")));
  } catch {
    return { version: 1, orders: {} };
  }
}

export function writeProductionPlanStore(store: ProductionPlanStore): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const clean = sanitizeProductionPlanStore(store);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(clean, null, 2), "utf8");
  fs.renameSync(temp, file);
}

export function readOrderProductionPlan(orderId: number): OrderProductionPlan | null {
  if (!Number.isInteger(orderId) || orderId <= 0) return null;
  return readProductionPlanStore().orders[String(orderId)] ?? null;
}

export function saveOrderProductionPlan(plan: OrderProductionPlan): void {
  const store = readProductionPlanStore();
  store.orders[String(plan.orderId)] = plan;
  writeProductionPlanStore(store);
}

export function deleteOrderProductionPlan(orderId: number): void {
  const store = readProductionPlanStore();
  if (!store.orders[String(orderId)]) return;
  delete store.orders[String(orderId)];
  writeProductionPlanStore(store);
}

export function updateProductionStepMachine(orderId: number, operationId: number, machineId: number | null): boolean {
  const store = readProductionPlanStore();
  const plan = store.orders[String(orderId)];
  const hit = findProductionStepByOperation(plan, operationId);
  if (!hit) return false;
  hit.step.machineId = machineId;
  writeProductionPlanStore(store);
  return true;
}

export function productionItemForMaterial(
  orderId: number,
  materialId: number,
): PlannedProductionItem | null {
  return findProductionItemByMaterial(readOrderProductionPlan(orderId), materialId);
}

export function productionStepForOperation(
  orderId: number,
  operationId: number,
): { item: PlannedProductionItem; step: PlannedProductionStep; index: number } | null {
  return findProductionStepByOperation(readOrderProductionPlan(orderId), operationId);
}
