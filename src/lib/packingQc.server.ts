// ============================================================================
// Packing QC — server-side readers shared by /api/packing-qc and /api/dispatch.
// Legacy checks stay in `orders`; independent material-batch checks use
// `batches`, keyed by orderMaterials.id. No database migration.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_QC_TEMPLATE, normalizeChecks, sanitizeTemplate } from "@/lib/packingQc";

export interface PackingChecksStore {
  version: 2;
  orders: Record<string, boolean[]>;
  batches: Record<string, boolean[]>;
}

function dataDir(): string {
  return process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
}

function templateLocation(): string {
  return path.join(dataDir(), "packing-qc-template.json");
}

function checksLocation(): string {
  return path.join(dataDir(), "packing-qc.json");
}

function sanitizeCheckMap(raw: unknown): Record<string, boolean[]> {
  const out: Record<string, boolean[]> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!/^\d+$/.test(key)) continue;
    out[key] = normalizeChecks(value, Array.isArray(value) ? value.length : 0);
  }
  return out;
}

/** The active template. A MISSING file means the factory default list. */
export function readTemplateWithDefault(): { template: string[]; isDefault: boolean } {
  try {
    const parsed = JSON.parse(fs.readFileSync(templateLocation(), "utf8"));
    if (Array.isArray(parsed?.template)) {
      return { template: sanitizeTemplate(parsed.template), isDefault: false };
    }
  } catch {
    /* fall through to the factory default */
  }
  return { template: [...DEFAULT_QC_TEMPLATE], isDefault: true };
}

export function readTemplateFile(): string[] {
  return readTemplateWithDefault().template;
}

export function readPackingChecksStore(): PackingChecksStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(checksLocation(), "utf8"));
    return {
      version: 2,
      orders: sanitizeCheckMap(parsed?.orders),
      batches: sanitizeCheckMap(parsed?.batches),
    };
  } catch {
    return { version: 2, orders: {}, batches: {} };
  }
}

export function writePackingChecksStore(store: PackingChecksStore): void {
  const file = checksLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const clean: PackingChecksStore = {
    version: 2,
    orders: sanitizeCheckMap(store.orders),
    batches: sanitizeCheckMap(store.batches),
  };
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(clean, null, 2), "utf8");
  fs.renameSync(temp, file);
}

/** Legacy whole-order checks, retained for old rows and as migration fallback. */
export function readChecksFile(): Record<string, boolean[]> {
  return readPackingChecksStore().orders;
}

/** Independent checks for material-batch Dispatch rows. */
export function readBatchChecksFile(): Record<string, boolean[]> {
  return readPackingChecksStore().batches;
}
