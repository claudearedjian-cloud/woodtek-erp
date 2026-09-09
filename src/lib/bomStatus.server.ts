// ============================================================================
// Warehouse fulfilment status for BOM allocations — SERVER ONLY.
// The orderMaterials table has no workflow columns and we avoid DB migrations,
// so the Requested -> Prepared -> Delivered flow lives in a JSON overlay
// keyed by allocation id (data/bom-status.json; survives rebuilds, backed up).
// ============================================================================

import fs from "node:fs";
import path from "node:path";

export type BomStatus = "Requested" | "Prepared" | "Delivered";

export interface BomStatusEntry {
  status: BomStatus;
  machineId?: number | null;
  updatedAt?: string;
}

export interface BomStatusFile {
  version: 1;
  entries: Record<string, BomStatusEntry>;
}

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "bom-status.json");
}

export function readBomStatus(): BomStatusFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    if (parsed && typeof parsed.entries === "object" && parsed.entries) {
      return { version: 1, entries: parsed.entries };
    }
  } catch {
    /* missing or corrupt -> empty */
  }
  return { version: 1, entries: {} };
}

export function setBomStatus(
  allocationId: number,
  status: BomStatus,
  machineId?: number | null,
): void {
  const data = readBomStatus();
  data.entries[String(allocationId)] = {
    status,
    machineId: machineId ?? null,
    updatedAt: new Date().toISOString(),
  };
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}
