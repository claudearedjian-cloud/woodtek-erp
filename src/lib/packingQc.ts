// ============================================================================
// Packing QC checklist — a short list of checks the warehouse must tick before
// an order leaves the Packing stage. Pure helpers here:
//   • the TEMPLATE (same list for every order) lives in
//     data/packing-qc-template.json — an empty list disables the gate;
//     a MISSING file means "factory default template".
//   • legacy per-order checks and independent material-batch checks live in
//     data/packing-qc.json (`orders` + `batches`).
// No DB migration. Server enforcement in PUT /api/dispatch (packing →
// awaiting_delivery refuses until that batch's every check is ticked).
// ============================================================================

export const MAX_QC_ITEMS = 12;
export const MAX_QC_ITEM_LENGTH = 120;

export const DEFAULT_QC_TEMPLATE: string[] = [
  "All BOM materials packed and counted",
  "Fragile parts wrapped and protected",
  "Hardware bags sealed and labelled",
  "Packing slip printed and attached",
  "Photos taken for the delivery record",
];

/** Clean a template coming from a hand-edited file or the Settings form. */
export function sanitizeTemplate(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== "string") continue;
    const text = value.replace(/\s+/g, " ").trim().slice(0, MAX_QC_ITEM_LENGTH);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= MAX_QC_ITEMS) break;
  }
  return out;
}

/** True when the template actually gates packing (non-empty list). */
export function templateGates(template: string[]): boolean {
  return Array.isArray(template) && template.length > 0;
}

/** Coerce stored/submitted checks into a fixed-length boolean array. */
export function normalizeChecks(raw: unknown, length: number): boolean[] {
  const source = Array.isArray(raw) ? raw : [];
  const out: boolean[] = [];
  for (let i = 0; i < length; i++) out.push(source[i] === true);
  return out;
}

export function checklistComplete(checks: boolean[]): boolean {
  return checks.length > 0 && checks.every(Boolean);
}

export function checklistProgress(checks: boolean[]): number {
  return checks.reduce((sum, done) => sum + (done === true ? 1 : 0), 0);
}
