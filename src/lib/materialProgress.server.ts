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
import { orderMaterials, orderOperations } from "@/db/schema";
import { sanitizeProgressMap, sanitizeStage, stageLadder } from "@/lib/materialProgress";

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
 * sitting ON that step's stage is carried one stage further (next step, or
 * DONE after the last one) — a forgotten "Finished here" tap can never
 * strand a cut list. Lines already tapped forward/ahead are untouched.
 * NEVER throws.
 */
export async function autoCompleteMaterialsForStep(orderId: number, opName: string): Promise<void> {
  try {
    const ops = await db
      .select({ name: orderOperations.operationName, stepOrder: orderOperations.stepOrder })
      .from(orderOperations)
      .where(eq(orderOperations.orderId, orderId));
    const ladder = stageLadder(ops.sort((a, b) => a.stepOrder - b.stepOrder).map((o) => o.name));
    const target = sanitizeStage(opName);
    const idx = ladder.indexOf(target);
    if (idx === -1 || idx >= ladder.length - 1) return;
    const next = ladder[idx + 1];
    const lines = await db
      .select({ id: orderMaterials.id })
      .from(orderMaterials)
      .where(eq(orderMaterials.orderId, orderId));
    const progress = readAllProgress();
    const now = new Date().toISOString();
    let changed = false;
    for (const line of lines) {
      const key = String(line.id);
      if (sanitizeStage(progress[key]?.stage ?? "") === target) {
        progress[key] = { stage: next, at: now, by: "auto (step completed)" };
        changed = true;
      }
    }
    if (changed) writeAllProgress(progress);
  } catch (e) {
    console.warn("material completion carry-over skipped:", e instanceof Error ? e.message : e);
  }
}
