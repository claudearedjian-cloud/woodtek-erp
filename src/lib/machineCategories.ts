// ============================================================================
// Machine categories — shared pure helpers.
// Safe to import from client components AND server routes (no node imports).
// Categories are editable names (e.g. "Beam Saw", "CNC"); a machine belongs to
// exactly one category via machines.category. Stored as JSON by
// /api/machine-categories (data/machine-categories.json).
// ============================================================================

/** Validates an untrusted list of category names. */
export function sanitizeCategories(input: unknown): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (!Array.isArray(input)) return out;
  for (const entry of input) {
    const name = String(entry ?? "").trim().slice(0, 40);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= 50) break;
  }
  return out;
}

/**
 * Picks the machine with the least open work. `openLoad` maps machine id to
 * its number of open operations (Pending/Ready/In Progress); machines under
 * active downtime should be pre-penalised by the caller. Ties break by id.
 */
export function chooseFreestMachine<T extends { id: number }>(
  candidates: T[],
  openLoad: Record<number, number>,
): T | null {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  let best: T | null = null;
  let bestLoad = Infinity;
  for (const c of candidates) {
    const load = openLoad[c.id] ?? 0;
    if (load < bestLoad || (load === bestLoad && best !== null && c.id < best.id)) {
      best = c;
      bestLoad = load;
    }
  }
  return best;
}
