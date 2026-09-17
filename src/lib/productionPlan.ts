// ============================================================================
// Material production plans (v2)
//
// A production item is one named cut list / material batch. It owns one stock
// allocation and one independent operation chain. Unlike the legacy material
// route (an array of machine-category strings), this snapshot keeps the real
// operation name, category, duration, assignment mode, repeated machine visits
// and the operation id created for every pass.
// ============================================================================

export const MAX_PRODUCTION_ITEMS = 80;
export const MAX_PRODUCTION_STEPS = 20;
export const MAX_PRODUCTION_ITEM_NAME = 80;
export const MAX_OPERATION_NAME = 80;
export const MAX_MACHINE_CATEGORY = 40;
export const MAX_RECIPE_NAME = 80;
export const MAX_ESTIMATED_MINUTES = 24 * 60;

export type ProductionRouteSource = "default" | "recipe" | "custom";

export interface ProductionRouteStep {
  operationName: string;
  machineCategory: string;
  estimatedMinutes: number;
  auto: boolean;
  machineId: number | null;
}

export interface ProductionItemInput {
  clientKey: string;
  name: string;
  itemId: number;
  quantityUsed: number;
  routeSource: ProductionRouteSource;
  recipeId: number | null;
  recipeName: string;
  steps: ProductionRouteStep[];
}

export interface PlannedProductionStep extends ProductionRouteStep {
  operationId: number;
  position: number;
  stageKey: string;
}

export interface PlannedProductionItem {
  materialId: number;
  itemId: number;
  name: string;
  quantityUsed: number;
  routeSource: ProductionRouteSource;
  recipeId: number | null;
  recipeName: string;
  steps: PlannedProductionStep[];
}

export interface OrderProductionPlan {
  orderId: number;
  createdAt: string;
  defaultSteps: ProductionRouteStep[];
  items: PlannedProductionItem[];
}

export interface ProductionPlanStore {
  version: 1;
  orders: Record<string, OrderProductionPlan>;
}

function cleanText(raw: unknown, max: number): string {
  return typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function positiveInt(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function sanitizeRouteSource(raw: unknown): ProductionRouteSource {
  return raw === "recipe" || raw === "custom" ? raw : "default";
}

/** Preserve every valid step in sequence, including repeated categories. */
export function sanitizeProductionRoute(raw: unknown): ProductionRouteStep[] {
  if (!Array.isArray(raw)) return [];
  const steps: ProductionRouteStep[] = [];
  for (const value of raw.slice(0, MAX_PRODUCTION_STEPS)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const operationName = cleanText(row.operationName, MAX_OPERATION_NAME);
    const machineCategory = cleanText(row.machineCategory, MAX_MACHINE_CATEGORY);
    if (!operationName || !machineCategory) continue;
    const requestedMinutes = Math.round(Number(row.estimatedMinutes));
    const estimatedMinutes = Number.isFinite(requestedMinutes)
      ? Math.min(MAX_ESTIMATED_MINUTES, Math.max(1, requestedMinutes))
      : 60;
    const auto = row.auto !== false;
    steps.push({
      operationName,
      machineCategory,
      estimatedMinutes,
      auto,
      machineId: auto ? null : positiveInt(row.machineId),
    });
    if (steps.length >= MAX_PRODUCTION_STEPS) break;
  }
  return steps;
}

/** Full recipe snapshot. It deliberately does NOT deduplicate machine visits. */
export function productionRouteFromTemplate(defaultStepsJson: unknown): ProductionRouteStep[] {
  if (!Array.isArray(defaultStepsJson)) return [];
  return sanitizeProductionRoute(
    [...defaultStepsJson]
      .sort((a: any, b: any) => (Number(a?.stepOrder) || 0) - (Number(b?.stepOrder) || 0))
      .map((step: any) => ({
        operationName: step?.operationName,
        machineCategory: step?.machineCategory || step?.defaultMachineCategory,
        estimatedMinutes: step?.estimatedMinutes,
        auto: true,
        machineId: null,
      })),
  );
}

/** Validate and normalize the material rows received by POST /api/orders. */
export function sanitizeProductionItems(raw: unknown): ProductionItemInput[] {
  if (!Array.isArray(raw)) return [];
  const items: ProductionItemInput[] = [];
  for (let index = 0; index < Math.min(raw.length, MAX_PRODUCTION_ITEMS); index++) {
    const value = raw[index];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const row = value as Record<string, unknown>;
    const itemId = positiveInt(row.itemId);
    const name = cleanText(row.name, MAX_PRODUCTION_ITEM_NAME);
    const steps = sanitizeProductionRoute(row.steps);
    if (!itemId || !name || steps.length === 0) continue;
    items.push({
      clientKey: cleanText(row.clientKey, 100) || `item-${index + 1}`,
      name,
      itemId,
      quantityUsed: Math.min(1_000_000, positiveInt(row.quantityUsed) ?? 1),
      routeSource: sanitizeRouteSource(row.routeSource),
      recipeId: positiveInt(row.recipeId),
      recipeName: cleanText(row.recipeName, MAX_RECIPE_NAME),
      steps,
    });
    if (items.length >= MAX_PRODUCTION_ITEMS) break;
  }
  return items;
}

/** A unique, readable progress-stage key. Position keeps repeated passes apart. */
export function productionStageKey(position: number, operationName: string): string {
  const pos = Math.max(1, Math.floor(Number(position) || 1));
  const prefix = `${pos}. `;
  return prefix + cleanText(operationName, Math.max(1, 40 - prefix.length));
}

export function routeStageKeys(item: Pick<PlannedProductionItem, "steps">): string[] {
  return item.steps.map((step) => step.stageKey || productionStageKey(step.position, step.operationName));
}

export function findProductionItemByMaterial(
  plan: OrderProductionPlan | null | undefined,
  materialId: number,
): PlannedProductionItem | null {
  return plan?.items.find((item) => item.materialId === Number(materialId)) ?? null;
}

export function findProductionStepByOperation(
  plan: OrderProductionPlan | null | undefined,
  operationId: number,
): { item: PlannedProductionItem; step: PlannedProductionStep; index: number; batchNumber: number } | null {
  if (!plan) return null;
  for (let batchIndex = 0; batchIndex < plan.items.length; batchIndex++) {
    const item = plan.items[batchIndex];
    const index = item.steps.findIndex((step) => step.operationId === Number(operationId));
    if (index !== -1) {
      return { item, step: item.steps[index], index, batchNumber: batchIndex + 1 };
    }
  }
  return null;
}

export function nextProductionOperationId(
  plan: OrderProductionPlan | null | undefined,
  operationId: number,
): number | null {
  const hit = findProductionStepByOperation(plan, operationId);
  return hit?.item.steps[hit.index + 1]?.operationId ?? null;
}

export function previousProductionOperationId(
  plan: OrderProductionPlan | null | undefined,
  operationId: number,
): number | null {
  const hit = findProductionStepByOperation(plan, operationId);
  return hit && hit.index > 0 ? hit.item.steps[hit.index - 1].operationId : null;
}

function sanitizePlannedStep(raw: unknown, fallbackPosition: number): PlannedProductionStep | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const base = sanitizeProductionRoute([row])[0];
  const operationId = positiveInt(row.operationId);
  if (!base || !operationId) return null;
  const position = positiveInt(row.position) ?? fallbackPosition;
  return {
    ...base,
    operationId,
    position,
    stageKey: cleanText(row.stageKey, 40) || productionStageKey(position, base.operationName),
  };
}

export function sanitizeStoredOrderPlan(raw: unknown): OrderProductionPlan | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const orderId = positiveInt(row.orderId);
  if (!orderId || !Array.isArray(row.items)) return null;
  const items: PlannedProductionItem[] = [];
  for (const value of row.items.slice(0, MAX_PRODUCTION_ITEMS)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as Record<string, unknown>;
    const materialId = positiveInt(item.materialId);
    const itemId = positiveInt(item.itemId);
    const name = cleanText(item.name, MAX_PRODUCTION_ITEM_NAME);
    if (!materialId || !itemId || !name || !Array.isArray(item.steps)) continue;
    const steps = item.steps
      .map((step, index) => sanitizePlannedStep(step, index + 1))
      .filter((step): step is PlannedProductionStep => Boolean(step))
      .slice(0, MAX_PRODUCTION_STEPS);
    if (steps.length === 0) continue;
    items.push({
      materialId,
      itemId,
      name,
      quantityUsed: Math.min(1_000_000, positiveInt(item.quantityUsed) ?? 1),
      routeSource: sanitizeRouteSource(item.routeSource),
      recipeId: positiveInt(item.recipeId),
      recipeName: cleanText(item.recipeName, MAX_RECIPE_NAME),
      steps,
    });
    if (items.length >= MAX_PRODUCTION_ITEMS) break;
  }
  if (items.length === 0) return null;
  return {
    orderId,
    createdAt: typeof row.createdAt === "string" ? row.createdAt.slice(0, 40) : "",
    defaultSteps: sanitizeProductionRoute(row.defaultSteps),
    items,
  };
}

export function sanitizeProductionPlanStore(raw: unknown): ProductionPlanStore {
  const store: ProductionPlanStore = { version: 1, orders: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return store;
  const orders = (raw as Record<string, unknown>).orders;
  if (!orders || typeof orders !== "object" || Array.isArray(orders)) return store;
  for (const [key, value] of Object.entries(orders as Record<string, unknown>)) {
    if (!/^\d+$/.test(key)) continue;
    const plan = sanitizeStoredOrderPlan(value);
    if (plan && String(plan.orderId) === key) store.orders[key] = plan;
  }
  return store;
}
