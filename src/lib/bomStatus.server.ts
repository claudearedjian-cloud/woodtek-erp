// ============================================================================
// Warehouse fulfilment + operator receipt for BOM allocations — SERVER ONLY.
// The orderMaterials table has no workflow columns and we avoid DB migrations,
// so Requested -> Prepared -> Delivered (per line) and the operator's
// received/not-received confirmation (per order) live in a JSON overlay
// (data/bom-status.json; survives rebuilds, covered by backups).
// ============================================================================

import fs from "node:fs";
import path from "node:path";

export type BomStatus = "Requested" | "Prepared" | "Delivered";

export interface BomStatusEntry {
  status: BomStatus;
  machineId?: number | null;
  updatedAt?: string;
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

export interface BomBoardState {
  version: 1;
  entries: Record<string, BomStatusEntry>;
  received: Record<string, BomReceivedEntry>;
}

type RawFile = BomBoardState;

type BomCache = {
  file: string;
  mtimeMs: number;
  size: number;
  data: RawFile;
};

let bomCache: BomCache | null = null;

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
    });
  } catch {
    if (bomCache?.file === file && bomCache.mtimeMs === -1) return bomCache.data;
    return cacheData(file, { version: 1, entries: {}, received: {} });
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
): void {
  const current = readRaw();
  const data: RawFile = {
    ...current,
    entries: {
      ...current.entries,
      [String(allocationId)]: {
        status,
        machineId: machineId ?? null,
        deliveredQty: typeof deliveredQty === "number" && deliveredQty > 0 ? deliveredQty : null,
        updatedAt: new Date().toISOString(),
      },
    },
  };
  writeRaw(data);
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
  let changed = false;

  for (const rawId of allocationIds) {
    const id = Number(rawId);
    if (!Number.isInteger(id) || id <= 0) continue;
    const key = String(id);
    if (Object.prototype.hasOwnProperty.call(entries, key)) {
      delete entries[key];
      changed = true;
    }
  }
  if (Number.isInteger(orderId) && orderId > 0 && Object.prototype.hasOwnProperty.call(received, String(orderId))) {
    delete received[String(orderId)];
    changed = true;
  }
  if (changed) writeRaw({ version: 1, entries, received });
}

/** Reset only order/BOM workflow state; shared warehouse configuration is unaffected. */
export function clearAllBomOrderState(): void {
  writeRaw({ version: 1, entries: {}, received: {} });
}
