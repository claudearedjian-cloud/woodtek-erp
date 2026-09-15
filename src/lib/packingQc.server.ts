// ============================================================================
// Packing QC — server-side readers shared by /api/packing-qc and the QC gate
// inside /api/dispatch. Storage: data/packing-qc-template.json (missing file
// = factory default; empty array = gate disabled) and data/packing-qc.json.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { DEFAULT_QC_TEMPLATE, normalizeChecks, sanitizeTemplate } from "@/lib/packingQc";

function dataDir(): string {
  return process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
}

function templateLocation(): string {
  return path.join(dataDir(), "packing-qc-template.json");
}

function checksLocation(): string {
  return path.join(dataDir(), "packing-qc.json");
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

/** Per-order checks keyed by order id, each kept at its stored length. */
export function readChecksFile(): Record<string, boolean[]> {
  try {
    const parsed = JSON.parse(fs.readFileSync(checksLocation(), "utf8"));
    const orders = parsed?.orders;
    if (orders && typeof orders === "object" && !Array.isArray(orders)) {
      const out: Record<string, boolean[]> = {};
      for (const [key, value] of Object.entries(orders)) {
        if (/^\d+$/.test(key)) {
          out[key] = normalizeChecks(value, Array.isArray(value) ? value.length : 0);
        }
      }
      return out;
    }
  } catch {
    /* missing or corrupt */
  }
  return {};
}
