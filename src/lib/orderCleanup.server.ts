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

function clearArchiveOrder(orderId: number): void {
  const parsed = readJson("order-archive.json");
  if (!parsed) return;
  const current = sanitizeArchivedIds(parsed.archived);
  const next = current.filter((id) => id !== orderId);
  if (next.length !== current.length) {
    writeJson("order-archive.json", { version: 1, archived: next });
  }
}

function deliveryPattern(orderId?: number): RegExp {
  return orderId
    ? new RegExp(`^delivery-${orderId}-\\d+-\\d+\\.(jpg|png|webp)$`)
    : /^delivery-\d+-\d+-\d+\.(jpg|png|webp)$/;
}

function removeDeliveryPhotos(orderId?: number): void {
  const parsed = readJson("delivery-photos.json");
  if (parsed) {
    const current = parsed.orders && typeof parsed.orders === "object" && !Array.isArray(parsed.orders)
      ? parsed.orders
      : {};
    if (orderId == null) {
      writeJson("delivery-photos.json", { version: 1, orders: {} });
    } else if (Object.prototype.hasOwnProperty.call(current, String(orderId))) {
      const next = { ...current };
      delete next[String(orderId)];
      writeJson("delivery-photos.json", { ...parsed, version: 1, orders: next });
    }
  }

  const uploads = path.join(dataDir(), "uploads", "delivery");
  if (!fs.existsSync(uploads)) return;
  const pattern = deliveryPattern(orderId);
  for (const name of fs.readdirSync(uploads)) {
    if (!pattern.test(name)) continue;
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
export function clearDeletedOrderRuntimeState(orderId: number, materialIds: readonly number[]): string[] {
  const warnings: string[] = [];
  if (!Number.isInteger(orderId) || orderId <= 0) return ["invalid order id"];

  attempt(warnings, "BOM/reception", () => clearBomOrderState(orderId, materialIds));
  attempt(warnings, "material progress", () => clearMaterialProgress(materialIds));
  attempt(warnings, "legacy material routes", () => clearMaterialRoutes(materialIds));
  attempt(warnings, "production plan", () => deleteOrderProductionPlan(orderId));
  attempt(warnings, "order archive", () => clearArchiveOrder(orderId));
  attempt(warnings, "dispatch state", () => removeRecordKey("dispatch-status.json", "stages", orderId));
  attempt(warnings, "packing QC", () => removeRecordKey("packing-qc.json", "orders", orderId));
  attempt(warnings, "delivery photos", () => removeDeliveryPhotos(orderId));
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
  attempt(warnings, "order archive", () => writeJson("order-archive.json", { version: 1, archived: [] }));
  attempt(warnings, "dispatch state", () => writeJson("dispatch-status.json", { version: 1, stages: {} }));
  attempt(warnings, "packing QC", () => writeJson("packing-qc.json", { version: 1, orders: {} }));
  attempt(warnings, "delivery photos", () => removeDeliveryPhotos());
  return warnings;
}
