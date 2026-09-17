// ============================================================================
// Project categories (the "Project Category" dropdown on the order form).
// Editable by Managers; stored as JSON by /api/project-types.
// Safe to import from client components AND server routes.
// ============================================================================

export const DEFAULT_PROJECT_TYPES = [
  "Custom Hospitality Furniture",
  "Custom Kitchens",
  "Wardrobe Fit-out",
  "Commercial Office & Retail",
  "Precision Sizing & Banding Only",
];

export { sanitizeCategories as sanitizeProjectTypes } from "@/lib/machineCategories";

/** Keep a valid selected category, otherwise move to the first saved one. */
export function reconcileProjectType(types: readonly string[], current: string): string {
  const wanted = String(current || "").trim().toLowerCase();
  const match = types.find((type) => type.toLowerCase() === wanted);
  return match ?? types[0] ?? "";
}
