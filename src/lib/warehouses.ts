// ============================================================================
// Warehouse register — pure, client-safe.
//
// A warehouse is simply a place stock lives ("Main Warehouse", "Panel Store",
// "Site Container"). Items carry the warehouse name in inventoryItems.location
// as plain text, so this list is a picker + label, never a foreign key and
// never a database migration.
//
// Storage: <data>/warehouses.json (see warehouses.server.ts).
// ============================================================================

export interface Warehouse {
  /** Stable id (slug) — items keep their location TEXT, so ids never leak. */
  id: string;
  name: string;
  /** Short code shown in tables, e.g. MAIN, PANEL. Optional. */
  code: string;
  /** Optional free-text note (address, keeper, opening hours…). */
  address: string;
  active: boolean;
  createdAt: string;
}

export const WAREHOUSE_NAME_MAX = 60;
export const WAREHOUSE_CODE_MAX = 12;
export const WAREHOUSE_ADDRESS_MAX = 160;
export const MAX_WAREHOUSES = 60;

/** Every factory starts with one real place to put stock. */
export const DEFAULT_WAREHOUSES: Warehouse[] = [
  {
    id: "main",
    name: "Main Warehouse",
    code: "MAIN",
    address: "",
    active: true,
    createdAt: "1970-01-01T00:00:00.000Z",
  },
];

/** Ids are derived from the name so a rename keeps the same record. */
export function slugifyWarehouseId(value: unknown): string {
  const slug = String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "warehouse";
}

export function cleanWarehouseText(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

/** One warehouse from untrusted input, or null when there is no usable name. */
export function sanitizeWarehouse(raw: unknown, fallbackId = ""): Warehouse | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const name = cleanWarehouseText(source.name, WAREHOUSE_NAME_MAX);
  if (!name) return null;
  const code = cleanWarehouseText(source.code, WAREHOUSE_CODE_MAX).toUpperCase();
  const address = cleanWarehouseText(source.address, WAREHOUSE_ADDRESS_MAX);
  const id = cleanWarehouseText(source.id, 60) || fallbackId || slugifyWarehouseId(name);
  const createdAt = typeof source.createdAt === "string" && !Number.isNaN(new Date(source.createdAt).getTime())
    ? new Date(source.createdAt).toISOString()
    : new Date().toISOString();
  return {
    id: id.slice(0, 60),
    name,
    code,
    address,
    active: source.active === undefined ? true : Boolean(source.active),
    createdAt,
  };
}

/**
 * A whole warehouse list: names are unique (case-insensitive), ids are unique,
 * the list is capped and always holds at least one warehouse — an empty
 * register would leave the item form with nothing to pick.
 */
export function sanitizeWarehouseList(raw: unknown): Warehouse[] {
  if (!Array.isArray(raw)) return [];
  const out: Warehouse[] = [];
  const names = new Set<string>();
  const ids = new Set<string>();
  for (const entry of raw) {
    const warehouse = sanitizeWarehouse(entry);
    if (!warehouse) continue;
    const nameKey = warehouse.name.toLowerCase();
    if (names.has(nameKey)) continue;
    let id = warehouse.id;
    let bump = 2;
    while (ids.has(id)) {
      id = `${warehouse.id}-${bump}`.slice(0, 60);
      bump += 1;
    }
    names.add(nameKey);
    ids.add(id);
    out.push({ ...warehouse, id });
    if (out.length >= MAX_WAREHOUSES) break;
  }
  return out;
}

/** Read the register, falling back to the single default warehouse. */
export function effectiveWarehouses(list: Warehouse[] | null | undefined): Warehouse[] {
  return list && list.length > 0 ? list : DEFAULT_WAREHOUSES;
}

/** Just the names — what the inventory pickers and filters show. */
export function warehouseNames(list: Warehouse[] | null | undefined): string[] {
  return effectiveWarehouses(list).map((warehouse) => warehouse.name);
}

export function findWarehouseByName(
  list: Warehouse[] | null | undefined,
  name: unknown,
): Warehouse | null {
  const wanted = String(name ?? "").trim().toLowerCase();
  if (!wanted) return null;
  return effectiveWarehouses(list).find((warehouse) => warehouse.name.toLowerCase() === wanted) ?? null;
}

export interface WarehouseProblem {
  error: string;
}

/** Validates one create/update request against the current register. */
export function validateWarehouseInput(
  input: Warehouse,
  list: Warehouse[],
  options: { editingId?: string | null } = {},
): WarehouseProblem | null {
  if (!input.name) return { error: "Give the warehouse a name." };
  const editing = options.editingId ? String(options.editingId) : null;
  const clash = list.find(
    (warehouse) =>
      warehouse.name.toLowerCase() === input.name.toLowerCase()
      && warehouse.id !== editing,
  );
  if (clash) return { error: `"${input.name}" already exists — pick another name.` };
  return null;
}

/**
 * Renaming a warehouse must move the stock already stored there: items keep
 * the name in inventoryItems.location. Returns the rename pair when the name
 * actually changed.
 */
export function warehouseRename(
  previous: Warehouse | null,
  next: Warehouse,
): { from: string; to: string } | null {
  if (!previous) return null;
  if (previous.name === next.name) return null;
  return { from: previous.name, to: next.name };
}

/** A warehouse can only be removed when no stock item is stored there. */
export function warehouseDeleteBlocked(usageCount: number): boolean {
  return usageCount > 0;
}
