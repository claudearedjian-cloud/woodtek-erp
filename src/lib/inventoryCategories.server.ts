// ============================================================================
// Stock category list persistence — SERVER ONLY.
//
// The category list lives in data/inventory-categories.json (no DB
// migration); items keep their category as plain text on inventoryItems.
// Same conventions as the other overlays — WOODTEK_DATA_DIR (default
// ./data), atomic temp-file rename, covered by nightly backups.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems } from "@/db/schema";
import { DEFAULT_INVENTORY_CATEGORIES, sanitizeInventoryCategories } from "@/lib/inventoryCategories";

type RawFile = { version: 1; categories: string[] };

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "inventory-categories.json");
}

/** The saved list, or null when no file exists yet. */
export function readInventoryCategoriesFile(): string[] | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    if (Array.isArray(parsed?.categories)) {
      const clean = sanitizeInventoryCategories(parsed.categories);
      return clean.length > 0 ? clean : null;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeInventoryCategoriesFile(categories: string[]): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ version: 1, categories }, null, 2), "utf8");
  fs.renameSync(temp, file);
}

/** Categories that already exist on items (for bootstrapping the list). */
async function dbCategories(): Promise<string[]> {
  try {
    const rows = await db
      .selectDistinct({ category: inventoryItems.category })
      .from(inventoryItems);
    return sanitizeInventoryCategories(rows.map((r) => r.category));
  } catch {
    return [];
  }
}

/** Saved list, else defaults merged with whatever items already use. */
export async function effectiveInventoryCategories(): Promise<string[]> {
  const fromFile = readInventoryCategoriesFile();
  if (fromFile) return fromFile;
  return Array.from(new Set([...DEFAULT_INVENTORY_CATEGORIES, ...(await dbCategories())]));
}

/** How many items currently carry a category (case-insensitive). */
export async function countItemsByCategory(category: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(inventoryItems)
    .where(sql`lower(${inventoryItems.category}) = lower(${category})`);
  return Number(row?.n ?? 0);
}

/** Move every item from one category to another (case-insensitive). */
export async function renameItemsCategory(from: string, to: string): Promise<void> {
  if (from.trim() === to.trim()) return;
  await db
    .update(inventoryItems)
    .set({ category: to })
    .where(sql`lower(${inventoryItems.category}) = lower(${from})`);
}
