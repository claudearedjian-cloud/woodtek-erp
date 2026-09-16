// ============================================================================
// Per-material machine routing — each BOM material of an order can have its
// OWN sequence of machine steps (decided in the New Order wizard, e.g. panels:
// Beam Saw → Edge Banding, hardware: Assembly only). Stored per material line
// in data/material-routes.json (no migration). Steps are MACHINE CATEGORY
// names; a material WITHOUT a custom route keeps following the order's
// operation steps exactly as before.
// ============================================================================

import { sanitizeStage } from "@/lib/materialProgress";

export const MAX_ROUTE_STEPS = 12;

/** Clean a route coming from the wizard or a hand-edited file. */
export function sanitizeRouteSteps(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    const step = sanitizeStage(value);
    if (!step) continue;
    // collapse accidental double-taps: no identical consecutive steps
    if (out.length > 0 && out[out.length - 1].toLowerCase() === step.toLowerCase()) continue;
    out.push(step);
    if (out.length >= MAX_ROUTE_STEPS) break;
  }
  return out;
}

/** The material's stage ladder: not started → its steps → done. */
export function routeLadder(steps: string[]): string[] {
  return ["", ...steps, "DONE"];
}

/** Next stage for a material on its own route (null when at the end/unknown). */
export function nextInRoute(steps: string[], current: string): string | null {
  const ladder = routeLadder(steps);
  const idx = ladder.indexOf(sanitizeStage(current));
  if (idx === -1 || idx >= ladder.length - 1) return null;
  return ladder[idx + 1];
}
