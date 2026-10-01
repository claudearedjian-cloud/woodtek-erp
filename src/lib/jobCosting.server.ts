// Job costing & profitability — server half (reads only; no new tables).
//
// Everything is derived at read time from data the factory already records:
// orders (value), order_materials (BOM + unit-cost snapshot), order_operations
// (planned/actual minutes), machines (hourly rate) and quality_events (memo).
// The only thing this feature stores is the Manager's two settings — the
// operator labor rate and an optional overhead % — in data/job-costing.json
// (same crash-safe JSON-file pattern as optional-modules.json; no migration).
//
// Scope: orders and operations come through the SAME deny-by-default
// subqueries as every other order screen (listOrdersForUser /
// listOperationsForUser). A Sales Coordinator who holds the money grant sees
// the margins of their own orders only; a Manager sees everything.
import fs from "node:fs";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems, machines, orderMaterials } from "@/db/schema";
import type { SessionUser } from "@/lib/auth";
import { writeJsonAtomic } from "@/lib/atomicFile.server";
import { listOperationsForUser, listOrdersForUser, listQualityEventsForUser } from "@/lib/dataAccess";
import {
  DEFAULT_JOB_COST_SETTINGS,
  JobCostingError,
  costOrder,
  groupJobCosts,
  inScope,
  numericToCents,
  rangeStart,
  sanitizeJobCostSettings,
  totalsOf,
  type CostOperationInput,
  type JobCost,
  type JobCostRange,
  type JobCostScope,
  type JobCostSettings,
} from "@/lib/jobCosting";

export const JOB_COSTING_FILE = "job-costing.json";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, JOB_COSTING_FILE);
}

let cache: { mtimeMs: number; settings: JobCostSettings } | null = null;

/** Reads the settings file (mtime-cached). Missing/corrupt file = defaults (labor $0, overhead 0%). */
export function readJobCostSettings(): JobCostSettings {
  try {
    const st = fs.statSync(fileLocation());
    if (cache && cache.mtimeMs === st.mtimeMs) return cache.settings;
    const settings = sanitizeJobCostSettings(JSON.parse(fs.readFileSync(fileLocation(), "utf8")));
    cache = { mtimeMs: st.mtimeMs, settings };
    return settings;
  } catch {
    return { ...DEFAULT_JOB_COST_SETTINGS };
  }
}

export function writeJobCostSettings(input: JobCostSettings): JobCostSettings {
  const clean = sanitizeJobCostSettings(input);
  writeJsonAtomic(fileLocation(), { version: 1, ...clean, updatedAt: new Date().toISOString() });
  cache = null;
  return clean;
}

type ScopedData = {
  orders: Awaited<ReturnType<typeof listOrdersForUser>>;
  ops: Awaited<ReturnType<typeof listOperationsForUser>>;
  materials: Array<{
    id: number; orderId: number; itemName: string | null; itemSku: string | null; itemUnit: string | null;
    quantityUsed: number; costPerUnit: string; consumed: boolean; released: boolean;
  }>;
  quality: Awaited<ReturnType<typeof listQualityEventsForUser>>;
  machineRates: Map<number, number>;
};

async function loadScoped(user: SessionUser, orderId?: number): Promise<ScopedData> {
  const allOrders = (await listOrdersForUser(user)).filter((o) => o.status !== "Cancelled");
  const orders = orderId == null ? allOrders : allOrders.filter((o) => o.id === orderId);
  const ids = orders.map((o) => o.id);
  if (ids.length === 0) return { orders, ops: [], materials: [], quality: [], machineRates: new Map() };

  const idSet = new Set(ids);
  const ops = (await listOperationsForUser(user, orderId != null ? { orderId } : undefined)).filter((op) => idSet.has(op.orderId));
  const materials = await db
    .select({
      id: orderMaterials.id,
      orderId: orderMaterials.orderId,
      itemName: inventoryItems.name,
      itemSku: inventoryItems.sku,
      itemUnit: inventoryItems.unit,
      quantityUsed: orderMaterials.quantityUsed,
      costPerUnit: orderMaterials.costPerUnit,
      consumed: orderMaterials.consumed,
      released: orderMaterials.released,
    })
    .from(orderMaterials)
    .leftJoin(inventoryItems, eq(orderMaterials.itemId, inventoryItems.id))
    .where(and(inArray(orderMaterials.orderId, ids), eq(orderMaterials.released, false)));
  const quality = (await listQualityEventsForUser(user, orderId != null ? { orderId } : undefined)).filter((q) => idSet.has(q.orderId));
  const machineRows = await db.select({ id: machines.id, hourlyCost: machines.hourlyCost }).from(machines);
  const machineRates = new Map(machineRows.map((m) => [m.id, numericToCents(m.hourlyCost)]));
  return { orders, ops, materials, quality, machineRates };
}

function costRows(data: ScopedData, settings: JobCostSettings, now: Date): JobCost[] {
  const matsBy = new Map<number, ScopedData["materials"]>();
  for (const m of data.materials) matsBy.set(m.orderId, [...(matsBy.get(m.orderId) ?? []), m]);
  const opsBy = new Map<number, ScopedData["ops"]>();
  for (const op of data.ops) opsBy.set(op.orderId, [...(opsBy.get(op.orderId) ?? []), op]);
  const qualBy = new Map<number, ScopedData["quality"]>();
  for (const q of data.quality) qualBy.set(q.orderId, [...(qualBy.get(q.orderId) ?? []), q]);

  return data.orders.map((o) =>
    costOrder({
      order: {
        id: o.id,
        orderNumber: o.orderNumber,
        title: o.title,
        status: o.status,
        projectType: o.projectType,
        customerId: o.customerId,
        customerName: o.customerCompany || o.customerName || "—",
        totalValue: o.totalValue,
        createdAt: o.createdAt,
        dueDate: o.dueDate,
      },
      materials: (matsBy.get(o.id) ?? []).map((m) => ({
        id: m.id,
        itemName: m.itemName ?? "(deleted item)",
        itemSku: m.itemSku ?? "—",
        unit: m.itemUnit ?? "",
        quantityUsed: m.quantityUsed,
        costPerUnit: m.costPerUnit,
        consumed: m.consumed,
        released: m.released,
      })),
      operations: (opsBy.get(o.id) ?? []).map(
        (op): CostOperationInput => ({
          id: op.id,
          stepOrder: op.stepOrder,
          operationName: op.operationName,
          machineId: op.machineId,
          machineCode: op.machineCode,
          status: op.status,
          estimatedMinutes: op.estimatedMinutes,
          actualMinutes: op.actualMinutes,
          startTime: op.startTime,
          endTime: op.endTime,
        }),
      ),
      quality: (qualBy.get(o.id) ?? []).map((q) => ({
        id: q.id,
        eventType: q.eventType,
        quantity: q.quantity,
        estimatedCost: q.estimatedCost,
        reason: q.reason,
      })),
      machineRates: data.machineRates,
      settings,
      now,
    }),
  );
}

/** Board rows WITHOUT the per-line detail (keeps the list payload small). */
function slim(row: JobCost): Omit<JobCost, "materialLines" | "operationLines"> & { materialLines?: undefined; operationLines?: undefined } {
  const { materialLines: _m, operationLines: _o, ...rest } = row;
  void _m; void _o;
  return rest;
}

export async function jobCostingBoard(user: SessionUser, range: JobCostRange, scope: JobCostScope) {
  const now = new Date();
  const settings = readJobCostSettings();
  const data = await loadScoped(user);
  const since = rangeStart(range, now);
  const rows = costRows(data, settings, now)
    .filter((r) => inScope(r.status, scope) && (!since || new Date(r.createdAt) >= since))
    .sort((a, b) => a.profitCents - b.profitCents || a.orderNumber.localeCompare(b.orderNumber));
  return {
    generatedAt: now.toISOString(),
    range,
    scope,
    settings,
    totals: totalsOf(rows),
    byClient: groupJobCosts(rows, (r) => ({ key: String(r.customerId ?? r.customer), label: r.customer })),
    byProjectType: groupJobCosts(rows, (r) => ({ key: r.projectType, label: r.projectType })),
    orders: rows.map(slim),
  };
}

export async function jobCostDetail(user: SessionUser, orderId: number): Promise<JobCost> {
  const now = new Date();
  const data = await loadScoped(user, orderId);
  const [row] = costRows(data, readJobCostSettings(), now);
  if (!row) throw new JobCostingError("Order not found.", 404);
  return row;
}

/** Same numbers for the legacy Order Profitability report (date window on creation). */
export async function jobCostRowsForReport(user: SessionUser, from: Date, to: Date): Promise<JobCost[]> {
  const now = new Date();
  const data = await loadScoped(user);
  return costRows(data, readJobCostSettings(), now).filter((r) => {
    const created = new Date(r.createdAt);
    return created >= from && created <= to;
  });
}
