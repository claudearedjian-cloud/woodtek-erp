// ============================================================================
// Multi-operator machine assignment — SERVER ONLY (node imports).
// The machines table keeps a single assigned_operator_id (primary, legacy
// logic); the FULL crew per machine lives in a JSON overlay
// (data/machine-operators.json) so no DB migration is needed.
// ============================================================================

import fs from "node:fs";
import path from "node:path";

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

function readRaw(): Record<string, number[]> {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    const out: Record<string, number[]> = {};
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        const ids = cleanIds(v);
        if (ids.length) out[k] = ids;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writeRaw(map: Record<string, number[]>): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(map, null, 2), "utf8");
}

export function readMachineOperators(): Record<string, number[]> {
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
