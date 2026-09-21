// ============================================================================
// Panel dimensions persistence — SERVER ONLY.
//
// The inventoryItems table has no dimensions column and we avoid DB
// migrations, so physical dimensions (L x W x Thickness) for stock items
// live in a JSON overlay: data/inventory-dimensions.json. Same conventions
// as the other overlays — WOODTEK_DATA_DIR (default ./data), atomic
// temp-file rename, mtime cache, covered by nightly backups.
// ============================================================================

import fs from "node:fs";
import path from "node:path";

interface DimensionEntry {
  dimensions: string;
  updatedAt: string;
}

type RawFile = { version: 1; entries: Record<string, DimensionEntry> };

type Cache = { file: string; mtimeMs: number; size: number; data: RawFile };
let cache: Cache | null = null;

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "inventory-dimensions.json");
}

function cacheData(file: string, data: RawFile): RawFile {
  try {
    const stat = fs.statSync(file);
    cache = { file, mtimeMs: stat.mtimeMs, size: stat.size, data };
  } catch {
    cache = { file, mtimeMs: -1, size: -1, data };
  }
  return data;
}

function readRaw(): RawFile {
  const file = fileLocation();
  try {
    const stat = fs.statSync(file);
    if (cache?.file === file && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) {
      return cache.data;
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return cacheData(file, {
      version: 1,
      entries: parsed && typeof parsed.entries === "object" && parsed.entries ? parsed.entries : {},
    });
  } catch {
    if (cache?.file === file && cache.mtimeMs === -1) return cache.data;
    return cacheData(file, { version: 1, entries: {} });
  }
}

function writeRaw(data: RawFile): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temp, file);
  cacheData(file, data);
}

/** itemId -> dimensions string ("" never stored; absent = no dimensions). */
export function readInventoryDimensions(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(readRaw().entries)) {
    const value = String(entry?.dimensions ?? "").trim();
    if (value) out[key] = value;
  }
  return out;
}

/** Store dimensions for an item; an empty value deletes the entry. */
export function setInventoryDimension(itemId: number, dimensions: string): void {
  const data = readRaw();
  const key = String(itemId);
  const value = dimensions.trim();
  if (value.length === 0) {
    delete data.entries[key];
  } else {
    data.entries[key] = { dimensions: value, updatedAt: new Date().toISOString() };
  }
  writeRaw(data);
}

/** Drop any stored dimensions (item deletion). */
export function deleteInventoryDimension(itemId: number): void {
  setInventoryDimension(itemId, "");
}
