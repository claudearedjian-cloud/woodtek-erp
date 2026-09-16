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

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "material-progress.json");
}

export function readAllProgress(): Record<string, { stage: string; at: string; by: string }> {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    return sanitizeProgressMap(parsed?.progress);
  } catch {
    return {};
  }
}

export function writeAllProgress(progress: Record<string, { stage: string; at: string; by: string }>): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, progress }, null, 2), "utf8");
}



/**
 * Called when a machine step is marked Completed: every material still
 * sitting ON that step is carried one stage further — along ITS OWN route
 * when it has one (stage = machine category), else along the order's
 * operation ladder. A forgotten "Finished here" tap can never strand a cut
 * list. NEVER throws.
 */
export async function autoCompleteMaterialsForStep(orderId: number, machineId: number | null, opName: string): Promise<void> {
  try {
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
