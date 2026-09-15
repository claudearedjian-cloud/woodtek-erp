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

export type StageTone = "slate" | "amber" | "emerald";

/** How a stage renders: label + colour tone. */
export function stageDisplay(stage: string): { label: string; tone: StageTone } {
  const clean = sanitizeStage(stage);
  if (clean === STAGE_DONE) return { label: "✓ Done", tone: "emerald" };
  if (clean === "") return { label: "Not started", tone: "slate" };
  return { label: `→ ${clean}`, tone: "amber" };
}
