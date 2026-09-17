// ============================================================================
// Order lifecycle cleanup — SERVER ONLY.
//
// Order-linked workflow state lives partly in PostgreSQL and partly in JSON
// overlays because this installation deliberately avoids database migrations.
// Deleting an order must therefore remove both halves. Each normal deletion
// removes only that order's state; an explicit demo reset can clear every
// order-scoped overlay while preserving shared settings and audit history.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { clearAllBomOrderState, clearBomOrderState } from "@/lib/bomStatus.server";
import { clearAllMaterialProgress, clearMaterialProgress } from "@/lib/materialProgress.server";
import { clearAllMaterialRoutes, clearMaterialRoutes } from "@/lib/materialRoutes.server";
import { clearAllProductionPlans, deleteOrderProductionPlan } from "@/lib/productionPlan.server";
import {
  clearAllOperationMachineCandidates,
  clearOperationMachineCandidates,
} from "@/lib/operationMachineCandidates.server";
import { sanitizeArchivedIds } from "@/lib/orderArchive";

function dataDir(): string {
  return process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
}

function fileLocation(name: string): string {
  return path.join(dataDir(), name);
}

function readJson(name: string): Record<string, any> | null {
  const file = fileLocation(name);
  if (!fs.existsSync(file)) return null;
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
}

function writeJson(name: string, payload: Record<string, unknown>): void {
  const file = fileLocation(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(temp, file);
}

function removeRecordKey(name: string, field: string, id: number): void {
  const parsed = readJson(name);
  if (!parsed) return;
  const current = parsed[field];
  if (!current || typeof current !== "object" || Array.isArray(current)) return;
  const key = String(id);
  if (!Object.prototype.hasOwnProperty.call(current, key)) return;
  const next = { ...current };
  delete next[key];
  writeJson(name, { ...parsed, version: 1, [field]: next });
}

function removeRecordKeys(name: string, field: string, ids: readonly number[]): void {
  const parsed = readJson(name);
  if (!parsed) return;
  const current = parsed[field];
  if (!current || typeof current !== "object" || Array.isArray(current)) return;
  const keys = new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0).map(String));
  if (keys.size === 0) return;
  const next = { ...current };
  let changed = false;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(next, key)) continue;
    delete next[key];
    changed = true;
  }
  if (changed) writeJson(name, { ...parsed, version: 2, [field]: next });
}

function clearArchiveOrder(orderId: number): void {
  const parsed = readJson("order-archive.json");
  if (!parsed) return;
  const current = sanitizeArchivedIds(parsed.archived);
  const next = current.filter((id) => id !== orderId);
  if (next.length !== current.length) {
    writeJson("order-archive.json", { version: 1, archived: next });
  }
}

function removeDeliveryPhotos(orderId?: number, materialIds: readonly number[] = []): void {
  const parsed = readJson("delivery-photos.json");
  if (parsed) {
    const orders = parsed.orders && typeof parsed.orders === "object" && !Array.isArray(parsed.orders)
      ? { ...parsed.orders }
      : {};
    const batches = parsed.batches && typeof parsed.batches === "object" && !Array.isArray(parsed.batches)
      ? { ...parsed.batches }
      : {};
    if (orderId == null) {
      writeJson("delivery-photos.json", { version: 2, orders: {}, batches: {} });
    } else {
      delete orders[String(orderId)];
      for (const materialId of materialIds) delete batches[String(materialId)];
      writeJson("delivery-photos.json", { ...parsed, version: 2, orders, batches });
    }
  }

  const uploads = path.join(dataDir(), "uploads", "delivery");
  if (!fs.existsSync(uploads)) return;
  const batchIds = new Set(materialIds.map(Number).filter((id) => Number.isInteger(id) && id > 0));
  for (const name of fs.readdirSync(uploads)) {
    const legacyMatch = name.match(/^delivery-(\d+)-\d+-\d+\.(jpg|png|webp)$/);
    const batchMatch = name.match(/^delivery-batch-(\d+)-\d+-\d+\.(jpg|png|webp)$/);
    const remove = orderId == null
      ? Boolean(legacyMatch || batchMatch)
      : Number(legacyMatch?.[1]) === orderId || batchIds.has(Number(batchMatch?.[1]));
    if (!remove) continue;
    const file = path.join(uploads, name);
    if (fs.statSync(file).isFile()) fs.unlinkSync(file);
  }
}

function attempt(warnings: string[], label: string, action: () => void): void {
  try {
    action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`${label}: ${message}`);
  }
}

/** Remove every JSON state entry owned by one deleted order. */
export function clearDeletedOrderRuntimeState(
  orderId: number,
  materialIds: readonly number[],
  operationIds: readonly number[] = [],
): string[] {
  const warnings: string[] = [];
  if (!Number.isInteger(orderId) || orderId <= 0) return ["invalid order id"];

  attempt(warnings, "BOM/reception", () => clearBomOrderState(orderId, materialIds));
  attempt(warnings, "material progress", () => clearMaterialProgress(materialIds));
  attempt(warnings, "legacy material routes", () => clearMaterialRoutes(materialIds));
  attempt(warnings, "production plan", () => deleteOrderProductionPlan(orderId));
  attempt(warnings, "operation candidates", () => clearOperationMachineCandidates(operationIds));
  attempt(warnings, "order archive", () => clearArchiveOrder(orderId));
  attempt(warnings, "dispatch state", () => {
    removeRecordKey("dispatch-status.json", "stages", orderId);
    removeRecordKeys("dispatch-status.json", "batches", materialIds);
  });
  attempt(warnings, "packing QC", () => {
    removeRecordKey("packing-qc.json", "orders", orderId);
    removeRecordKeys("packing-qc.json", "batches", materialIds);
  });
  attempt(warnings, "delivery photos", () => removeDeliveryPhotos(orderId, materialIds));
  return warnings;
}

/**
 * Reset all order-scoped overlays when an explicit demo reset is run. Shared
 * configuration, inventory and audit history deliberately remain intact.
 */
export function clearAllOrderRuntimeState(): string[] {
  const warnings: string[] = [];
  attempt(warnings, "BOM/reception", clearAllBomOrderState);
  attempt(warnings, "material progress", clearAllMaterialProgress);
  attempt(warnings, "legacy material routes", clearAllMaterialRoutes);
  attempt(warnings, "production plans", clearAllProductionPlans);
  attempt(warnings, "operation candidates", clearAllOperationMachineCandidates);
  attempt(warnings, "order archive", () => writeJson("order-archive.json", { version: 1, archived: [] }));
  attempt(warnings, "dispatch state", () => writeJson("dispatch-status.json", { version: 2, stages: {}, batches: {} }));
  attempt(warnings, "packing QC", () => writeJson("packing-qc.json", { version: 2, orders: {}, batches: {} }));
  attempt(warnings, "delivery photos", () => removeDeliveryPhotos());
  return warnings;
}
