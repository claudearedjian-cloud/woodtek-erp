// ============================================================================
// Per-material machine routing — server-side storage shared by
// /api/material-routes, /api/operations (station cards) and the material
// stage ladder resolution. Storage: data/material-routes.json
// {version:1, routes:{"<orderMaterialsId>": ["Beam Saw", "Edge Banding", …]}}
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import { sanitizeRouteSteps } from "@/lib/materialRoutes";

type RouteMap = Record<string, string[]>;

type RouteCache = {
  file: string;
  mtimeMs: number;
  size: number;
  routes: RouteMap;
};

let routeCache: RouteCache | null = null;

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "material-routes.json");
}

function cacheRoutes(file: string, routes: RouteMap): void {
  try {
    const stat = fs.statSync(file);
    routeCache = { file, mtimeMs: stat.mtimeMs, size: stat.size, routes };
  } catch {
    routeCache = { file, mtimeMs: -1, size: -1, routes };
  }
}

export function readAllRoutes(): RouteMap {
  const file = fileLocation();
  try {
    const stat = fs.statSync(file);
    if (routeCache?.file === file && routeCache.mtimeMs === stat.mtimeMs && routeCache.size === stat.size) {
      return { ...routeCache.routes };
    }
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const routes = parsed?.routes;
    const out: RouteMap = {};
    if (routes && typeof routes === "object" && !Array.isArray(routes)) {
      for (const [key, value] of Object.entries(routes)) {
        if (/^\d+$/.test(key)) {
          const steps = sanitizeRouteSteps(value);
          if (steps.length > 0) out[key] = steps;
        }
      }
    }
    cacheRoutes(file, out);
    return { ...out };
  } catch {
    if (routeCache?.file === file && routeCache.mtimeMs === -1) return { ...routeCache.routes };
    cacheRoutes(file, {});
    return {};
  }
}

export function writeAllRoutes(routes: RouteMap): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, routes }, null, 2), "utf8");
  cacheRoutes(file, { ...routes });
}
