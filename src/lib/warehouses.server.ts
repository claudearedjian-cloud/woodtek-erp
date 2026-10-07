// ============================================================================
// Warehouse register persistence — SERVER ONLY.
//
// data/warehouses.json (mtime-cached, atomic writes) — the same no-migration
// pattern as inventory-categories.json and appearance.json. Stock items keep
// the warehouse NAME in inventoryItems.location, so renames migrate those rows
// and a delete is refused while items are still stored in that warehouse.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "@/lib/atomicFile.server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems } from "@/db/schema";
import {
  DEFAULT_WAREHOUSES,
  effectiveWarehouses,
  sanitizeWarehouseList,
  type Warehouse,
} from "@/lib/warehouses";

const FILE_NAME = "warehouses.json";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, FILE_NAME);
}

let cache: { filePath: string; mtimeMs: number; list: Warehouse[] } | null = null;

/** The saved register, or null when no file exists yet. */
export function readWarehousesFile(): Warehouse[] | null {
  const loc = fileLocation();
  try {
    const st = fs.statSync(loc);
    if (cache && cache.filePath === loc && cache.mtimeMs === st.mtimeMs) return cache.list;
    const parsed = JSON.parse(fs.readFileSync(loc, "utf8"));
    const clean = sanitizeWarehouseList(parsed?.warehouses);
    if (clean.length === 0) return null;
    cache = { filePath: loc, mtimeMs: st.mtimeMs, list: clean };
    return clean;
  } catch {
    return null;
  }
}

export function writeWarehousesFile(list: Warehouse[]): Warehouse[] {
  const clean = sanitizeWarehouseList(list);
  const loc = fileLocation();
  writeJsonAtomic(loc, { version: 1, warehouses: clean });
  cache = { filePath: loc, mtimeMs: fs.statSync(loc).mtimeMs, list: clean };
  return clean;
}

/** Saved register, else the default single warehouse. */
export function effectiveWarehouseList(): Warehouse[] {
  return effectiveWarehouses(readWarehousesFile() ?? DEFAULT_WAREHOUSES);
}

/** Warehouses with "how many stock items live here" — for the manager panel. */
export interface WarehouseUsage extends Warehouse {
  itemCount: number;
  unitCount: number;
}

export async function warehouseUsage(list?: Warehouse[]): Promise<WarehouseUsage[]> {
  const warehouses = list ?? effectiveWarehouseList();
  let rows: { location: string | null; items: number; units: number }[] = [];
  try {
    rows = await db
      .select({
        location: inventoryItems.location,
        items: sql<number>`count(*)::int`,
        units: sql<number>`coalesce(sum(${inventoryItems.stockQuantity}), 0)::int`,
      })
      .from(inventoryItems)
      .groupBy(inventoryItems.location);
  } catch {
    rows = [];
  }
  const byName = new Map(rows.map((row) => [String(row.location ?? "").trim().toLowerCase(), row]));
  return warehouses.map((warehouse) => {
    const row = byName.get(warehouse.name.trim().toLowerCase());
    return {
      ...warehouse,
      itemCount: Number(row?.items ?? 0),
      unitCount: Number(row?.units ?? 0),
    };
  });
}

/** How many stock items are stored in one named warehouse. */
export async function warehouseItemCount(name: string): Promise<number> {
  try {
    const rows = await db
      .select({ items: sql<number>`count(*)::int` })
      .from(inventoryItems)
      .where(eq(inventoryItems.location, name));
    return Number(rows[0]?.items ?? 0);
  } catch {
    return 0;
  }
}

/** Renames every stock item stored in `from` so the register stays truthful. */
export async function renameWarehouseItems(from: string, to: string): Promise<number> {
  if (!from.trim() || !to.trim() || from === to) return 0;
  try {
    const updated = await db
      .update(inventoryItems)
      .set({ location: to })
      .where(eq(inventoryItems.location, from))
      .returning({ id: inventoryItems.id });
    return updated.length;
  } catch {
    return 0;
  }
}
