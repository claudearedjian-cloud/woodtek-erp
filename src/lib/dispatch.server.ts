// ============================================================================
// Batch-level Dispatch storage — SERVER ONLY.
// File: <WOODTEK_DATA_DIR>/dispatch-status.json
//
// `stages` preserves the original order-keyed records for legacy orders.
// `batches` is keyed by orderMaterials.id so every material/cut-list can move,
// pass QC and prove delivery independently without a database migration.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { ALL_STAGES, defaultStage, type DispatchStage } from "@/lib/dispatch";

export interface DispatchProof {
  receivedBy: string;
  deliveredAt: string;
  notes: string | null;
}

export interface DispatchEntry {
  stage: DispatchStage;
  orderId?: number;
  createdAt?: string;
  updatedAt?: string;
  proof?: DispatchProof | null;
}

export interface DispatchStore {
  version: 2;
  stages: Record<string, DispatchEntry>;
  batches: Record<string, DispatchEntry>;
}

function dataDir(): string {
  return process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
}

function fileLocation(): string {
  return path.join(dataDir(), "dispatch-status.json");
}

function lockLocation(): string {
  return path.join(dataDir(), ".dispatch-status.lock");
}

function cleanIso(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function sanitizeProof(raw: unknown): DispatchProof | null | undefined {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const source = raw as Record<string, unknown>;
  const deliveredAt = cleanIso(source.deliveredAt);
  if (!deliveredAt) return undefined;
  return {
    receivedBy: String(source.receivedBy ?? "—").trim().slice(0, 120) || "—",
    deliveredAt,
    notes: String(source.notes ?? "").trim().slice(0, 500) || null,
  };
}

function sanitizeEntries(raw: unknown, includeOrderId: boolean): Record<string, DispatchEntry> {
  const out: Record<string, DispatchEntry> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (!/^\d+$/.test(key) || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const source = value as Record<string, unknown>;
    const stage = String(source.stage ?? "") as DispatchStage;
    if (!ALL_STAGES.includes(stage)) continue;
    const orderId = Number(source.orderId);
    if (includeOrderId && (!Number.isInteger(orderId) || orderId <= 0)) continue;
    const proof = sanitizeProof(source.proof);
    out[key] = {
      stage,
      ...(includeOrderId ? { orderId } : {}),
      ...(cleanIso(source.createdAt) ? { createdAt: cleanIso(source.createdAt) } : {}),
      ...(cleanIso(source.updatedAt) ? { updatedAt: cleanIso(source.updatedAt) } : {}),
      ...(proof !== undefined ? { proof } : {}),
    };
  }
  return out;
}

export function readDispatchStore(): DispatchStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    return {
      version: 2,
      stages: sanitizeEntries(parsed?.stages, false),
      batches: sanitizeEntries(parsed?.batches, true),
    };
  } catch {
    return { version: 2, stages: {}, batches: {} };
  }
}

function writeDispatchStore(store: DispatchStore): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const clean: DispatchStore = {
    version: 2,
    stages: sanitizeEntries(store.stages, false),
    batches: sanitizeEntries(store.batches, true),
  };
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(clean, null, 2), "utf8");
  fs.renameSync(temp, file);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(): Promise<() => void> {
  fs.mkdirSync(dataDir(), { recursive: true });
  const lock = lockLocation();
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      const fd = fs.openSync(lock, "wx");
      fs.writeFileSync(fd, `${process.pid}\n${new Date().toISOString()}\n`, "utf8");
      return () => {
        try { fs.closeSync(fd); } catch { /* already closed */ }
        try { fs.unlinkSync(lock); } catch { /* already removed */ }
      };
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const stat = fs.statSync(lock);
        if (Date.now() - stat.mtimeMs > 30_000) {
          fs.unlinkSync(lock);
          continue;
        }
      } catch {
        continue;
      }
      await delay(25);
    }
  }
  throw new Error("Dispatch is busy. Please retry the stage update.");
}

/** Cross-process lock around a read/modify/atomic-write cycle. */
export async function updateDispatchStore<T>(
  updater: (store: DispatchStore) => T | Promise<T>,
): Promise<T> {
  const release = await acquireLock();
  try {
    const store = readDispatchStore();
    const result = await updater(store);
    writeDispatchStore(store);
    return result;
  } finally {
    release();
  }
}

export async function ensureDispatchBatches(input: {
  orderId: number;
  materialIds: readonly number[];
  projectType?: string | null;
  createdAt?: Date | string | null;
  orderStatus?: string | null;
}): Promise<void> {
  const orderId = Number(input.orderId);
  const materialIds = Array.from(new Set(
    input.materialIds.map(Number).filter((id) => Number.isInteger(id) && id > 0),
  ));
  if (!Number.isInteger(orderId) || orderId <= 0 || materialIds.length === 0) return;
  await updateDispatchStore((store) => {
    const inherited = store.stages[String(orderId)];
    const createdAt = cleanIso(input.createdAt) ?? new Date().toISOString();
    for (const materialId of materialIds) {
      const key = String(materialId);
      if (store.batches[key]) continue;
      const stage = inherited?.stage
        ?? (input.orderStatus === "Delivered" ? "delivered" : defaultStage(input.projectType));
      store.batches[key] = {
        stage,
        orderId,
        createdAt,
        updatedAt: inherited?.updatedAt ?? createdAt,
        proof: inherited?.proof ?? null,
      };
    }
  });
}

/** Reserve one order-level delivery row when an issued order has no material batches. */
export async function ensureLegacyDispatchOrder(input: {
  orderId: number;
  projectType?: string | null;
  createdAt?: Date | string | null;
  orderStatus?: string | null;
}): Promise<void> {
  const orderId = Number(input.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0) return;
  await updateDispatchStore((store) => {
    const key = String(orderId);
    if (store.stages[key]) return;
    const createdAt = cleanIso(input.createdAt) ?? new Date().toISOString();
    store.stages[key] = {
      stage: input.orderStatus === "Delivered" ? "delivered" : defaultStage(input.projectType),
      createdAt,
      updatedAt: createdAt,
      proof: null,
    };
  });
}

export async function removeDispatchBatch(materialId: number): Promise<void> {
  if (!Number.isInteger(materialId) || materialId <= 0) return;
  await updateDispatchStore((store) => {
    delete store.batches[String(materialId)];
  });
}

export async function clearAllDispatchState(): Promise<void> {
  await updateDispatchStore((store) => {
    store.stages = {};
    store.batches = {};
  });
}
