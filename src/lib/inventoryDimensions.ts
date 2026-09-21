// ============================================================================
// Panel dimensions — pure model, no framework imports (client-safe).
//
// Stock items in a panel category are entered with physical dimensions
// (L x W x Thickness, e.g. "2440 x 1220 x 18"). The stored value is a free
// string persisted in the data/inventory-dimensions.json overlay (no DB
// migration); these helpers decide WHICH categories get the field and what
// counts as a valid value.
// ============================================================================

/** True for the panel stock category ("Wood & MDF Panels"), tolerant to casing/wording drift. */
export function isPanelCategory(category: string | null | undefined): boolean {
  return String(category || "").trim().toLowerCase().includes("panel");
}

/** Collapse whitespace so "2440  x 1220" stores as "2440 x 1220". */
export function normalizeDimensions(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const NUMERIC = /^\d+(?:[.,]\d+)?$/;

/**
 * Returns an error message, or null when valid.
 * Accepted shapes: 1–4 numeric parts separated by x / × / * (e.g.
 * "18", "1220 x 2440", "2440 x 1220 x 18"), with an optional trailing unit
 * (mm / cm / in). Empty string is valid — it clears the field.
 */
export function validateDimensions(value: unknown): string | null {
  const v = normalizeDimensions(value);
  if (v.length === 0) return null;
  if (v.length > 40) return "Keep dimensions within 40 characters.";
  const core = v.replace(/\s*(mm|cm|in|inches|")\s*$/i, "").trim();
  const parts = core.split(/\s*(?:x|×|\*)\s*/i).map((p) => p.trim());
  if (parts.length < 1 || parts.length > 4) {
    return "Enter dimensions as L x W x Thickness, e.g. 2440 x 1220 x 18.";
  }
  if (!parts.every((p) => NUMERIC.test(p))) {
    return "Each dimension must be a number, e.g. 2440 x 1220 x 18.";
  }
  return null;
}
