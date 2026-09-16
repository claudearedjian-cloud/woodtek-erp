// ============================================================================
// Material production stage — where each BOM material line of an order sits
// in production right now (e.g. one panel pack still Cutting, the other
// already on Edge Banding). Stored per material line id in
// data/material-progress.json (no migration). Stages are the order's own
// operation step names, plus "" (not started) and "DONE".
// ============================================================================

export const STAGE_DONE = "DONE";
export const STAGE_MAX_LENGTH = 40;

/** Trim / collapse whitespace / cap a stage string ("" = not started). */
export function sanitizeStage(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/\s+/g, " ").trim().slice(0, STAGE_MAX_LENGTH);
}

export interface MaterialStageEntry {
  stage: string;
  at: string;
  by: string;
}

/** Clean a stored {materialId: entry} map coming from file or API. */
export function sanitizeProgressMap(raw: unknown): Record<string, MaterialStageEntry> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, MaterialStageEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^\d+$/.test(key)) continue;
    if (!value || typeof value !== "object") continue;
    const entry = value as Record<string, unknown>;
    const stage = sanitizeStage(entry.stage);
    if (!stage) continue;
    out[key] = {
      stage,
      at: typeof entry.at === "string" ? entry.at.slice(0, 40) : "",
      by: typeof entry.by === "string" ? entry.by.slice(0, 120) : "—",
    };
  }
  return out;
}

/**
 * The stage ladder for an order: Not started → step 1 → … → step N → DONE.
 * Every material line walks this ladder in order — no skipping ahead.
 */
export function stageLadder(steps: string[]): string[] {
  return ["", ...steps.map((s) => sanitizeStage(s)).filter(Boolean), STAGE_DONE];
}

/**
 * Stages a line may move to from `current`: stay, one back, one forward.
 * An unknown current stage (renamed step, hand-edited file) may go anywhere
 * so it stays correctable.
 */
/** Position of a stage in the ladder (-1 = unknown / custom). */
export function ladderIndex(ladder: string[], stage: string): number {
  return ladder.indexOf(sanitizeStage(stage));
}

export function allowedStages(steps: string[], current: string): string[] {
  const ladder = stageLadder(steps);
  const idx = ladder.indexOf(sanitizeStage(current));
  if (idx === -1) return ladder;
  const out = new Set<string>();
  for (const i of [idx - 1, idx, idx + 1]) {
    if (i >= 0 && i < ladder.length) out.add(ladder[i]);
  }
  return Array.from(out);
}

export type StageTone = "slate" | "amber" | "emerald";

/** How a stage renders: label + colour tone. */
export function stageDisplay(stage: string): { label: string; tone: StageTone } {
  const clean = sanitizeStage(stage);
  if (clean === STAGE_DONE) return { label: "✓ Done", tone: "emerald" };
  if (clean === "") return { label: "Not started", tone: "slate" };
  return { label: `→ ${clean}`, tone: "amber" };
}
