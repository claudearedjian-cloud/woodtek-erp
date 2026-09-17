// ============================================================================
// Server storage for operation machine candidates.
// File: <WOODTEK_DATA_DIR>/operation-machine-candidates.json
//
// The relational operation row remains the source of truth for the claimed
// machine. This no-migration overlay exists only while work is waiting to start.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import {
  effectiveCandidateMachineIds,
  sanitizeCandidateMachineIds,
  type OperationMachineCandidateEntry,
  type OperationMachineCandidateMap,
} from "@/lib/operationMachineCandidates";

interface CandidateStore {
  version: 1;
  operations: OperationMachineCandidateMap;
}

type CandidateCache = {
  file: string;
  mtimeMs: number;
  size: number;
  store: CandidateStore;
};

let candidateCache: CandidateCache | null = null;

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "operation-machine-candidates.json");
}

function sanitizeEntry(raw: unknown): OperationMachineCandidateEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const machineIds = sanitizeCandidateMachineIds(source.machineIds);
  if (machineIds.length === 0) return null;
  const updatedById = Number(source.updatedById);
  return {
    machineIds,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt.slice(0, 40) : undefined,
    updatedById: Number.isInteger(updatedById) && updatedById > 0 ? updatedById : undefined,
  };
}

function sanitizeStore(raw: unknown): CandidateStore {
  const operations: OperationMachineCandidateMap = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const source = (raw as Record<string, unknown>).operations;
    if (source && typeof source === "object" && !Array.isArray(source)) {
      for (const [key, value] of Object.entries(source)) {
        if (!/^\d+$/.test(key)) continue;
        const entry = sanitizeEntry(value);
        if (entry) operations[key] = entry;
      }
    }
  }
  return { version: 1, operations };
}

function cacheStore(file: string, store: CandidateStore): CandidateStore {
  try {
    const stat = fs.statSync(file);
    candidateCache = { file, mtimeMs: stat.mtimeMs, size: stat.size, store };
  } catch {
    candidateCache = { file, mtimeMs: -1, size: -1, store };
  }
  return store;
}

export function readOperationMachineCandidateStore(): CandidateStore {
  const file = fileLocation();
  try {
    const stat = fs.statSync(file);
    if (
      candidateCache?.file === file
      && candidateCache.mtimeMs === stat.mtimeMs
      && candidateCache.size === stat.size
    ) {
      return candidateCache.store;
    }
    return cacheStore(file, sanitizeStore(JSON.parse(fs.readFileSync(file, "utf8"))));
  } catch {
    if (candidateCache?.file === file && candidateCache.mtimeMs === -1) return candidateCache.store;
    return cacheStore(file, { version: 1, operations: {} });
  }
}

export function writeOperationMachineCandidateStore(store: CandidateStore): void {
  const file = fileLocation();
  const clean = sanitizeStore(store);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(clean, null, 2), "utf8");
  fs.renameSync(temp, file);
  cacheStore(file, clean);
}

export function readOperationMachineCandidates(): OperationMachineCandidateMap {
  return readOperationMachineCandidateStore().operations;
}

export function operationMachineCandidates(
  operationId: number,
  persistedMachineId: number | null | undefined,
  status: string | null | undefined,
): number[] {
  const entry = readOperationMachineCandidates()[String(operationId)];
  return effectiveCandidateMachineIds(persistedMachineId, status, entry);
}

export function candidateOperationIdsForMachine(machineId: number): number[] {
  if (!Number.isInteger(machineId) || machineId <= 0) return [];
  const out: number[] = [];
  for (const [key, entry] of Object.entries(readOperationMachineCandidates())) {
    if (entry.machineIds.includes(machineId)) out.push(Number(key));
  }
  return out.filter((id) => Number.isInteger(id) && id > 0);
}

export function setOperationMachineCandidates(
  operationId: number,
  machineIds: readonly number[],
  updatedById?: number,
): void {
  if (!Number.isInteger(operationId) || operationId <= 0) return;
  const cleanIds = sanitizeCandidateMachineIds(machineIds);
  if (cleanIds.length === 0) return;
  const current = readOperationMachineCandidateStore();
  writeOperationMachineCandidateStore({
    version: 1,
    operations: {
      ...current.operations,
      [String(operationId)]: {
        machineIds: cleanIds,
        updatedAt: new Date().toISOString(),
        updatedById: Number.isInteger(updatedById) && Number(updatedById) > 0 ? Number(updatedById) : undefined,
      },
    },
  });
}

export function removeMachineFromOperationCandidates(machineId: number): void {
  if (!Number.isInteger(machineId) || machineId <= 0) return;
  const current = readOperationMachineCandidateStore();
  const operations = { ...current.operations };
  let changed = false;
  for (const [key, entry] of Object.entries(operations)) {
    if (!entry.machineIds.includes(machineId)) continue;
    const machineIds = entry.machineIds.filter((id) => id !== machineId);
    if (machineIds.length > 0) operations[key] = { ...entry, machineIds };
    else delete operations[key];
    changed = true;
  }
  if (changed) writeOperationMachineCandidateStore({ version: 1, operations });
}

export function clearOperationMachineCandidates(operationIds: readonly number[]): void {
  const ids = new Set(operationIds.map(Number).filter((id) => Number.isInteger(id) && id > 0).map(String));
  if (ids.size === 0) return;
  const current = readOperationMachineCandidateStore();
  const operations = { ...current.operations };
  let changed = false;
  for (const key of ids) {
    if (!Object.prototype.hasOwnProperty.call(operations, key)) continue;
    delete operations[key];
    changed = true;
  }
  if (changed) writeOperationMachineCandidateStore({ version: 1, operations });
}

export function clearAllOperationMachineCandidates(): void {
  writeOperationMachineCandidateStore({ version: 1, operations: {} });
}
