// ============================================================================
// Multi-operator machine assignment — SERVER ONLY (node imports).
// The machines table keeps a single assigned_operator_id (primary, legacy
// logic); the FULL crew per machine lives in a JSON overlay
// (data/machine-operators.json) so no DB migration is needed.
// ============================================================================

import fs from "node:fs";
import path from "node:path";

type CrewMap = Record<string, number[]>;

type CrewCache = {
  file: string;
  mtimeMs: number;
  size: number;
  crews: CrewMap;
};

let crewCache: CrewCache | null = null;

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "machine-operators.json");
}

function cleanIds(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return Array.from(
    new Set(v.map((x) => Number(x)).filter((n) => Number.isInteger(n) && n > 0)),
  ).slice(0, 20);
}

function cacheCrews(file: string, crews: CrewMap): void {
  try {
    const stat = fs.statSync(file);
    crewCache = { file, mtimeMs: stat.mtimeMs, size: stat.size, crews };
  } catch {
    crewCache = { file, mtimeMs: -1, size: -1, crews };
  }
}

function readRaw(): CrewMap {
  const file = fileLocation();
  try {
    const stat = fs.statSync(file);
    if (crewCache?.file === file && crewCache.mtimeMs === stat.mtimeMs && crewCache.size === stat.size) {
      return { ...crewCache.crews };
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const out: CrewMap = {};
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const ids = cleanIds(v);
        if (ids.length) out[k] = ids;
      }
    }
    cacheCrews(file, out);
    return { ...out };
  } catch {
    if (crewCache?.file === file && crewCache.mtimeMs === -1) return { ...crewCache.crews };
    cacheCrews(file, {});
    return {};
  }
}

function writeRaw(map: CrewMap): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(map, null, 2), { encoding: "utf8", flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      /* best-effort cleanup; the original assignment file remains intact */
    }
  }
  cacheCrews(file, { ...map });
}

export function readMachineOperators(): CrewMap {
  return readRaw();
}

export function setMachineOperators(machineId: number, ids: number[]): void {
  const map = readRaw();
  const clean = cleanIds(ids);
  if (clean.length) map[String(machineId)] = clean;
  else delete map[String(machineId)];
  writeRaw(map);
}

export function removeMachineOperators(machineId: number): void {
  const map = readRaw();
  delete map[String(machineId)];
  writeRaw(map);
}

/** Overlay crew first; falls back to the legacy primary operator column. */
export function effectiveOperatorIds(
  machineId: number,
  fallbackPrimary: number | null,
): number[] {
  const list = readRaw()[String(machineId)];
  if (list && list.length) return list;
  return fallbackPrimary != null ? [fallbackPrimary] : [];
}
