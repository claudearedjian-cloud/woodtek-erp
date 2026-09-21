// ============================================================================
// Stock categories (Wood & Edge Stock) — pure/client-safe.
// Editable by Managers; stored as JSON by /api/inventory-categories (same
// convention as project types). Safe to import from client components AND
// server routes.
// ============================================================================

export const DEFAULT_INVENTORY_CATEGORIES = [
  "Wood & MDF Panels",
  "Edge Banding",
  "Hardware & Fittings",
  "Coatings & Adhesives",
];

export { sanitizeCategories as sanitizeInventoryCategories } from "@/lib/machineCategories";
