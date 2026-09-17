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

type PlanCache = {
  file: string;
  mtimeMs: number;
  size: number;
  store: ProductionPlanStore;
};

let planCache: PlanCache | null = null;

function cacheStore(file: string, store: ProductionPlanStore): ProductionPlanStore {
  try {
    const stat = fs.statSync(file);
    planCache = { file, mtimeMs: stat.mtimeMs, size: stat.size, store };
  } catch {
    planCache = { file, mtimeMs: -1, size: -1, store };
  }
  return store;
}

export function readProductionPlanStore(): ProductionPlanStore {
  const file = fileLocation();
  try {
    const stat = fs.statSync(file);
    if (
      planCache?.file === file
      && planCache.mtimeMs === stat.mtimeMs
      && planCache.size === stat.size
    ) {
      return planCache.store;
    }
    const store = sanitizeProductionPlanStore(JSON.parse(fs.readFileSync(file, "utf8")));
    return cacheStore(file, store);
  } catch {
    if (planCache?.file === file && planCache.mtimeMs === -1) return planCache.store;
    return cacheStore(file, { version: 1, orders: {} });
  }
}

export function writeProductionPlanStore(store: ProductionPlanStore): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const clean = sanitizeProductionPlanStore(store);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(clean, null, 2), "utf8");
  fs.renameSync(temp, file);
  cacheStore(file, clean);
}

export function readOrderProductionPlan(orderId: number): OrderProductionPlan | null {
  if (!Number.isInteger(orderId) || orderId <= 0) return null;
  return readProductionPlanStore().orders[String(orderId)] ?? null;
}

export function saveOrderProductionPlan(plan: OrderProductionPlan): void {
  const store = readProductionPlanStore();
  writeProductionPlanStore({
    ...store,
    orders: { ...store.orders, [String(plan.orderId)]: plan },
  });
}

export function deleteOrderProductionPlan(orderId: number): void {
  const store = readProductionPlanStore();
  if (!store.orders[String(orderId)]) return;
  const orders = { ...store.orders };
  delete orders[String(orderId)];
  writeProductionPlanStore({ ...store, orders });
}

export function updateProductionStepMachine(orderId: number, operationId: number, machineId: number | null): boolean {
  // Cached stores are read-only snapshots. Clone only on the rare write path so
  // a failed filesystem write can never leave the in-process cache half-mutated.
  const store = JSON.parse(JSON.stringify(readProductionPlanStore())) as ProductionPlanStore;
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

/** Reset all per-order plans after an intentional all-orders clean slate. */
export function clearAllProductionPlans(): void {
  writeProductionPlanStore({ version: 1, orders: {} });
}
