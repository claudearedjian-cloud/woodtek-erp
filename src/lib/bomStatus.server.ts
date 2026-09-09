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
}

export interface BomReceivedEntry {
  received: boolean;
  at?: string;
}

interface RawFile {
  version: 1;
  entries: Record<string, BomStatusEntry>;
  received: Record<string, BomReceivedEntry>;
}

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "bom-status.json");
}

function readRaw(): RawFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    return {
      version: 1,
      entries: parsed && typeof parsed.entries === "object" && parsed.entries ? parsed.entries : {},
      received: parsed && typeof parsed.received === "object" && parsed.received ? parsed.received : {},
    };
  } catch {
    return { version: 1, entries: {}, received: {} };
  }
}

function writeRaw(data: RawFile): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
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
): void {
  const data = readRaw();
  data.entries[String(allocationId)] = {
    status,
    machineId: machineId ?? null,
    updatedAt: new Date().toISOString(),
  };
  writeRaw(data);
}

export function setOrderReceived(orderId: number, received: boolean): void {
  const data = readRaw();
  data.received[String(orderId)] = { received, at: new Date().toISOString() };
  writeRaw(data);
}
