// ============================================================================
// Material production stage — server-side storage + the automatic moves that
// happen when a machine step starts/completes (see computeAutoAdvance in the
// pure lib). NEVER throws into the caller: production must not break because
// a tracking file could not be written.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orderMaterials, orderOperations, machines } from "@/db/schema";
import { sanitizeProgressMap, sanitizeStage, stageLadder } from "@/lib/materialProgress";
import { nextInRoute } from "@/lib/materialRoutes";
import { readAllRoutes } from "@/lib/materialRoutes.server";
import { findProductionStepByOperation } from "@/lib/productionPlan";
import { readOrderProductionPlan } from "@/lib/productionPlan.server";

type ProgressMap = Record<string, { stage: string; at: string; by: string }>;

type ProgressCache = {
  file: string;
  mtimeMs: number;
  size: number;
  progress: ProgressMap;
};

let progressCache: ProgressCache | null = null;

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "material-progress.json");
}

function cacheProgress(file: string, progress: ProgressMap): void {
  try {
    const stat = fs.statSync(file);
    progressCache = { file, mtimeMs: stat.mtimeMs, size: stat.size, progress };
  } catch {
    progressCache = { file, mtimeMs: -1, size: -1, progress };
  }
}

export function readAllProgress(): ProgressMap {
  const file = fileLocation();
  try {
    const stat = fs.statSync(file);
    if (
      progressCache?.file === file
      && progressCache.mtimeMs === stat.mtimeMs
      && progressCache.size === stat.size
    ) {
      return { ...progressCache.progress };
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const progress = sanitizeProgressMap(parsed?.progress);
    cacheProgress(file, progress);
    return { ...progress };
  } catch {
    if (progressCache?.file === file && progressCache.mtimeMs === -1) return { ...progressCache.progress };
    cacheProgress(file, {});
    return {};
  }
}

export function writeAllProgress(progress: ProgressMap): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, progress }, null, 2), "utf8");
  cacheProgress(file, { ...progress });
}



/** Keep a v2 material batch's visible stage synchronized with its operation. */
export function markPlannedMaterialAtOperation(
  orderId: number,
  operationId: number,
  by: string,
): void {
  try {
    const plan = readOrderProductionPlan(orderId);
    const hit = findProductionStepByOperation(plan, operationId);
    if (!hit) return;
    const progress = readAllProgress();
    progress[String(hit.item.materialId)] = {
      stage: hit.step.stageKey,
      at: new Date().toISOString(),
      by,
    };
    writeAllProgress(progress);
  } catch (error) {
    console.warn("planned material start tracking skipped:", error instanceof Error ? error.message : error);
  }
}

/**
 * Called when a machine step is marked Completed. V2 jobs advance exactly one
 * linked material batch by operation id, so repeated machine visits remain
 * distinct. Legacy orders retain their former category/name behavior.
 */
export async function autoCompleteMaterialsForStep(
  orderId: number,
  machineId: number | null,
  opName: string,
  operationId?: number,
): Promise<void> {
  try {
    if (operationId) {
      const plan = readOrderProductionPlan(orderId);
      const hit = findProductionStepByOperation(plan, operationId);
      if (hit) {
        const next = hit.item.steps[hit.index + 1];
        const progress = readAllProgress();
        progress[String(hit.item.materialId)] = {
          stage: next?.stageKey ?? "DONE",
          at: new Date().toISOString(),
          by: "auto (job completed)",
        };
        writeAllProgress(progress);
        return;
      }
    }

    let category: string | null = null;
    if (machineId) {
      const [m] = await db
        .select({ category: machines.category })
        .from(machines)
        .where(eq(machines.id, machineId));
      category = m?.category ?? null;
    }
    const ops = await db
      .select({ name: orderOperations.operationName, stepOrder: orderOperations.stepOrder })
      .from(orderOperations)
      .where(eq(orderOperations.orderId, orderId));
    const orderLadder = stageLadder(ops.sort((a, b) => a.stepOrder - b.stepOrder).map((o) => o.name));
    const routes = readAllRoutes();
    const lines = await db
      .select({ id: orderMaterials.id })
      .from(orderMaterials)
      .where(eq(orderMaterials.orderId, orderId));
    const progress = readAllProgress();
    const now = new Date().toISOString();
    let changed = false;
    for (const line of lines) {
      const key = String(line.id);
      const stage = sanitizeStage(progress[key]?.stage ?? "");
      const ownSteps = routes[key];
      // Custom route: the stage space is machine categories.
      if (ownSteps) {
        if (category && stage === category) {
          const next = nextInRoute(ownSteps, stage);
          if (next) {
            progress[key] = { stage: next, at: now, by: "auto (step completed)" };
            changed = true;
          }
        }
        continue;
      }
      // Default: the order's operation ladder.
      if (stage === sanitizeStage(opName)) {
        const idx = orderLadder.indexOf(stage);
        if (idx !== -1 && idx < orderLadder.length - 1) {
          progress[key] = { stage: orderLadder[idx + 1], at: now, by: "auto (step completed)" };
          changed = true;
        }
      }
    }
    if (changed) writeAllProgress(progress);
  } catch (e) {
    console.warn("material completion carry-over skipped:", e instanceof Error ? e.message : e);
  }
}

/** Remove progress chips belonging to deleted order-material allocations. */
export function clearMaterialProgress(materialIds: readonly number[]): void {
  const progress = readAllProgress();
  let changed = false;
  for (const rawId of materialIds) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) continue;
    const key = String(id);
    if (Object.prototype.hasOwnProperty.call(progress, key)) {
      delete progress[key];
      changed = true;
    }
  }
  if (changed) writeAllProgress(progress);
}

export function clearAllMaterialProgress(): void {
  writeAllProgress({});
}
