// ============================================================================
// Per-material machine routing — server-side storage shared by
// /api/material-routes, /api/operations (station cards) and the material
// stage ladder resolution. Storage: data/material-routes.json
// {version:1, routes:{"<orderMaterialsId>": ["Beam Saw", "Edge Banding", …]}}
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { sanitizeRouteSteps } from "@/lib/materialRoutes";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "material-routes.json");
}

export function readAllRoutes(): Record<string, string[]> {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    const routes = parsed?.routes;
    if (routes && typeof routes === "object" && !Array.isArray(routes)) {
      const out: Record<string, string[]> = {};
      for (const [key, value] of Object.entries(routes)) {
        if (/^\d+$/.test(key)) {
          const steps = sanitizeRouteSteps(value);
          if (steps.length > 0) out[key] = steps;
        }
      }
      return out;
    }
  } catch {
    /* missing or corrupt */
  }
  return {};
}

export function writeAllRoutes(routes: Record<string, string[]>): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, routes }, null, 2), "utf8");
}
