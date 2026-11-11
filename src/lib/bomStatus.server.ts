// ============================================================================
// Warehouse fulfilment + operator receipt for BOM allocations — SERVER ONLY.
// The orderMaterials table has no workflow columns and we avoid DB migrations,
// so Requested -> Prepared -> Delivered (per line) and the operator's
// received/not-received confirmation (per order) live in a JSON overlay
// (data/bom-status.json; survives rebuilds, covered by backups).
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "@/lib/atomicFile.server";

export type BomStatus = "Requested" | "Prepared" | "Delivered";

export interface BomStatusEntry {
  status: BomStatus;
  machineId?: number | null;
  updatedAt?: string;
  /** Partial-preparation tally (units ready in the warehouse). Null = none. */
  preparedQty?: number | null;
  /** Partial-delivery tally (units already sent to the floor). Null = none. */
  deliveredQty?: number | null;
}

export type ReceptionState = "Received" | "Not Received" | "Declined";

export interface BomReceivedEntry {
  received: boolean;
  /** Three-state reception decision by the Floor Supervisor (newer entries). */
  state?: ReceptionState;
  at?: string;
}

export interface BomReceiptLot {
  id: string;
  allocationId: number;
  quantity: number;
  at: string;
}

export interface BomBoardState {
  version: 1;
  entries: Record<string, BomStatusEntry>;
  received: Record<string, BomReceivedEntry>;
  /** Accepted quantities, retained separately so every receipt has its own route. */
  receiptLots: Record<string, BomReceiptLot[]>;
}

type RawFile = BomBoardState;

type BomCache = {
  file: string;
  mtimeMs: number;
  size: number;
  data: RawFile;
};

let bomCache: BomCache | null = null;
const receiptAllocationLocks = new Map<number, Promise<void>>();

/** Serialize receipt releases for one BOM line so parallel taps cannot over-accept it. */
export async function withReceiptAllocationLock<T>(allocationId: number, action: () => Promise<T>): Promise<T> {
  const previous = receiptAllocationLocks.get(allocationId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  receiptAllocationLocks.set(allocationId, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (receiptAllocationLocks.get(allocationId) === tail) receiptAllocationLocks.delete(allocationId);
  }
}

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "bom-status.json");
}

function cacheData(file: string, data: RawFile): RawFile {
  try {
    const stat = fs.statSync(file);
    bomCache = { file, mtimeMs: stat.mtimeMs, size: stat.size, data };
  } catch {
    bomCache = { file, mtimeMs: -1, size: -1, data };
  }
  return data;
}

function normalizeReceiptLots(raw: unknown): Record<string, BomReceiptLot[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: Record<string, BomReceiptLot[]> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const allocationId = Number(key);
    if (!Number.isSafeInteger(allocationId) || allocationId <= 0 || !Array.isArray(value)) continue;
    result[key] = value.flatMap((entry): BomReceiptLot[] => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
      const lot = entry as Record<string, unknown>;
      const quantity = Number(lot.quantity);
      if (typeof lot.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(lot.id) || !Number.isSafeInteger(quantity) || quantity <= 0) return [];
      return [{ id: lot.id, allocationId, quantity, at: typeof lot.at === "string" ? lot.at.slice(0, 40) : "" }];
    });
  }
  return result;
}

function readRaw(): RawFile {
  const file = fileLocation();
  try {
    const stat = fs.statSync(file);
    if (
      bomCache?.file === file
      && bomCache.mtimeMs === stat.mtimeMs
      && bomCache.size === stat.size
    ) {
      return bomCache.data;
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return cacheData(file, {
      version: 1,
      entries: parsed && typeof parsed.entries === "object" && parsed.entries ? parsed.entries : {},
      received: parsed && typeof parsed.received === "object" && parsed.received ? parsed.received : {},
      receiptLots: normalizeReceiptLots(parsed?.receiptLots),
    });
  } catch {
    if (bomCache?.file === file && bomCache.mtimeMs === -1) return bomCache.data;
    return cacheData(file, { version: 1, entries: {}, received: {}, receiptLots: {} });
  }
}

function writeRaw(data: RawFile): void {
  const file = fileLocation();
  // Crash-safe: the shared helper writes a temp file and renames it over the
  // target, so a power cut can never truncate the warehouse/BOM status file.
  writeJsonAtomic(file, data);
  cacheData(file, data);
}

export function readBomBoardState(): BomBoardState {
  return readRaw();
}

export function readBomStatus(): { version: 1; entries: Record<string, BomStatusEntry> } {
  const raw = readRaw();
  return { version: 1, entries: raw.entries };
}

export function readReceived(): Record<string, BomReceivedEntry> {
  return readRaw().received;
}

export function setBomStatus(
  allocationId: number,
  status: BomStatus,
  machineId?: number | null,
  deliveredQty?: number | null,
  preparedQty?: number | null,
): void {
  const current = readRaw();
  const data: RawFile = {
    ...current,
    entries: {
      ...current.entries,
      [String(allocationId)]: {
        status,
        machineId: machineId ?? null,
        preparedQty: typeof preparedQty === "number" && preparedQty > 0 ? Math.floor(preparedQty) : null,
        deliveredQty: typeof deliveredQty === "number" && deliveredQty > 0 ? Math.floor(deliveredQty) : null,
        updatedAt: new Date().toISOString(),
      },
    },
  };
  writeRaw(data);
}

export function setReceiptLot(allocationId: number, lot: BomReceiptLot): BomReceiptLot[] {
  const current = readRaw();
  const key = String(allocationId);
  const lots = [...(current.receiptLots[key] ?? []), lot];
  writeRaw({ ...current, receiptLots: { ...current.receiptLots, [key]: lots } });
  return lots;
}

export function receiptLotsForAllocation(allocationId: number): BomReceiptLot[] {
  return readRaw().receiptLots[String(allocationId)] ?? [];
}

export function setOrderReceived(orderId: number, received: boolean, state?: ReceptionState): void {
  const current = readRaw();
  writeRaw({
    ...current,
    received: {
      ...current.received,
      [String(orderId)]: { received, ...(state ? { state } : {}), at: new Date().toISOString() },
    },
  });
}

/** Remove warehouse line state and reception state owned by one order. */
export function clearBomOrderState(orderId: number, allocationIds: readonly number[]): void {
  const current = readRaw();
  const entries = { ...current.entries };
  const received = { ...current.received };
  const receiptLots = { ...current.receiptLots };
  let changed = false;

  for (const rawId of allocationIds) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) continue;
    const key = String(id);
    if (Object.prototype.hasOwnProperty.call(entries, key)) {
      delete entries[key];
      changed = true;
    }
    if (Object.prototype.hasOwnProperty.call(receiptLots, key)) {
      delete receiptLots[key];
      changed = true;
    }
  }
  if (Number.isInteger(orderId) && orderId > 0 && Object.prototype.hasOwnProperty.call(received, String(orderId))) {
    delete received[String(orderId)];
    changed = true;
  }
  if (changed) writeRaw({ version: 1, entries, received, receiptLots });
}

/** Reset only order/BOM workflow state; shared warehouse configuration is unaffected. */
export function clearAllBomOrderState(): void {
  writeRaw({ version: 1, entries: {}, received: {}, receiptLots: {} });
}
