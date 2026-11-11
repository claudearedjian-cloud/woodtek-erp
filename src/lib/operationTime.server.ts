// Server-side, crash-safe operation timing sidecar in data/operation-time.json.
// This deliberately avoids new DB columns/migrations and is included with the
// installation's existing data-directory backups.

import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "@/lib/atomicFile.server";
import {
  advanceOperationTime,
  type LegacyTimingFallback,
  type OperationTimeEntry,
  summarizeOperationTime,
} from "@/lib/operationTime";

interface OperationTimeStore {
  version: 1;
  operations: Record<string, OperationTimeEntry>;
}

function dataDir(): string {
  return process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
}

function storePath(): string {
  return path.join(dataDir(), "operation-time.json");
}

function lockPath(): string {
  return path.join(dataDir(), ".operation-time.lock");
}

function cleanDate(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function sanitizeEntry(raw: unknown): OperationTimeEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const startedAt = cleanDate(source.startedAt);
  if (!startedAt) return null;
  return {
    startedAt,
    executionSeconds: Math.max(0, Math.floor(Number(source.executionSeconds) || 0)),
    pausedSeconds: Math.max(0, Math.floor(Number(source.pausedSeconds) || 0)),
    activeSince: cleanDate(source.activeSince),
    pausedSince: cleanDate(source.pausedSince),
    completedAt: cleanDate(source.completedAt),
    historyComplete: source.historyComplete !== false,
  };
}

function readStore(): OperationTimeStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    const operations: Record<string, OperationTimeEntry> = {};
    if (parsed?.operations && typeof parsed.operations === "object" && !Array.isArray(parsed.operations)) {
      for (const [key, value] of Object.entries(parsed.operations)) {
        if (!/^\d+$/.test(key) || Number(key) <= 0) continue;
        const entry = sanitizeEntry(value);
        if (entry) operations[key] = entry;
      }
    }
    return { version: 1, operations };
  } catch {
    return { version: 1, operations: {} };
  }
}

function writeStore(store: OperationTimeStore): void {
  fs.mkdirSync(dataDir(), { recursive: true });
  writeJsonAtomic(storePath(), store);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLock(): Promise<() => void> {
  fs.mkdirSync(dataDir(), { recursive: true });
  const lock = lockPath();
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
        if (Date.now() - fs.statSync(lock).mtimeMs > 30_000) {
          fs.unlinkSync(lock);
          continue;
        }
      } catch {
        continue;
      }
      await delay(25);
    }
  }
  throw new Error("Operation timing is busy. Please retry the status update.");
}

export function readOperationTimeSummaries(
  operations: readonly {
    id: number;
    status: string;
    actualMinutes?: number | null;
    startTime?: Date | string | null;
    updatedAt?: Date | string | null;
    endTime?: Date | string | null;
  }[],
): Record<string, ReturnType<typeof summarizeOperationTime>> {
  const store = readStore();
  const now = new Date();
  const summaries: Record<string, ReturnType<typeof summarizeOperationTime>> = {};
  for (const operation of operations) {
    const id = Number(operation.id);
    if (!Number.isInteger(id) || id <= 0) continue;
    summaries[String(id)] = summarizeOperationTime(
      store.operations[String(id)] ?? null,
      operation.status,
      {
        actualMinutes: operation.actualMinutes,
        startTime: operation.startTime,
        updatedAt: operation.updatedAt,
        endTime: operation.endTime,
      },
      now,
    );
  }
  return summaries;
}

export async function recordOperationTimeTransition(input: {
  operationId: number;
  previousStatus: string;
  nextStatus: string;
  at: Date | string;
  fallback?: LegacyTimingFallback;
}): Promise<void> {
  const id = Number(input.operationId);
  if (!Number.isInteger(id) || id <= 0 || input.previousStatus === input.nextStatus) return;
  const release = await acquireLock();
  try {
    const store = readStore();
    const key = String(id);
    const next = advanceOperationTime(
      store.operations[key] ?? null,
      input.previousStatus,
      input.nextStatus,
      input.at,
      input.fallback,
    );
    if (next) store.operations[key] = next;
    else delete store.operations[key];
    writeStore(store);
  } finally {
    release();
  }
}

export async function removeOperationTimeEntries(operationIds: readonly number[]): Promise<void> {
  const ids = operationIds.map(Number).filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return;
  const release = await acquireLock();
  try {
    const store = readStore();
    for (const id of ids) delete store.operations[String(id)];
    writeStore(store);
  } finally {
    release();
  }
}
