// ============================================================================
// Material production stage — server-side storage + the automatic moves that
// happen when a machine step starts/completes (see computeAutoAdvance in the
// pure lib). NEVER throws into the caller: production must not break because
// a tracking file could not be written.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { orderMaterials, orderOperations } from "@/db/schema";
import { computeAutoAdvance, sanitizeProgressMap, type MaterialStageLine } from "@/lib/materialProgress";

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
 * Called after a machine step is set In Progress ("start": pending materials
 * become "cutting now") or Completed ("complete": materials at this step move
 * one further). Uses the operation NAME as the stage, matching the manual
 * dropdown and the ladder rule.
 */
export async function autoAdvanceMaterialsForStep(orderId: number, opName: string, mode: "start" | "complete"): Promise<void> {
  try {
    const ops = await db
      .select({ name: orderOperations.operationName, stepOrder: orderOperations.stepOrder })
      .from(orderOperations)
      .where(eq(orderOperations.orderId, orderId));
    const steps = ops.sort((a, b) => a.stepOrder - b.stepOrder).map((o) => o.name);
    const lines = await db
      .select({ id: orderMaterials.id })
      .from(orderMaterials)
      .where(eq(orderMaterials.orderId, orderId));
    if (lines.length === 0 || steps.length === 0) return;
    const progress = readAllProgress();
    const stageLines: MaterialStageLine[] = lines.map((l) => ({ id: l.id, stage: progress[String(l.id)]?.stage ?? "" }));
    const moves = computeAutoAdvance(stageLines, ["", ...steps, "DONE"], opName, mode);
    const ids = new Set(stageLines.map((l) => l.id));
    const now = new Date().toISOString();
    for (const [idRaw, stage] of Object.entries(moves)) {
      const id = Number(idRaw);
      if (!ids.has(id)) continue;
      progress[String(id)] = { stage, at: now, by: "auto" };
    }
    if (Object.keys(moves).length > 0) writeAllProgress(progress);
  } catch (e) {
    console.warn("material auto-advance skipped:", e instanceof Error ? e.message : e);
  }
}
