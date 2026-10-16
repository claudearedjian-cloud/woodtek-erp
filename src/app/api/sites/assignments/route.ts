// ============================================================================
// Supervisor assignments — which warehouses a Warehouse Supervisor covers and
// which floors a Floor Supervisor covers.
//
// GET  users:manage — the whole map (keyed by user id).
// PUT  users:manage — { userId, warehouseIds, floorIds } for one user. Empty
//      lists clear the assignment. Every id must exist.
// ============================================================================

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { MAX_ASSIGNED_PER_USER } from "@/lib/sites";
import { readSiteAssignments, readSitesConfig, writeSiteAssignments } from "@/lib/sites.server";
import { effectiveWarehouseList } from "@/lib/warehouses.server";

export const dynamic = "force-dynamic";

function idList(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const out = Array.from(new Set(value.map((id) => String(id ?? "").trim()).filter(Boolean)));
  return out.length <= MAX_ASSIGNED_PER_USER ? out : null;
}

export async function GET() {
  const { error } = await authorize("users:manage");
  if (error) return error;
  return NextResponse.json({ assignments: readSiteAssignments() });
}

export async function PUT(request: Request) {
  const { user, error } = await authorize("users:manage");
  if (error || !user) return error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const userId = Number(body?.userId);
  if (!Number.isInteger(userId) || userId <= 0) {
    return NextResponse.json({ error: "Choose a user first." }, { status: 400 });
  }
  const [target] = await db.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, userId));
  if (!target) return NextResponse.json({ error: "That user no longer exists." }, { status: 404 });

  const warehouseIds = idList(body?.warehouseIds);
  const floorIds = idList(body?.floorIds);
  if (warehouseIds === null || floorIds === null) {
    return NextResponse.json({ error: `Choose at most ${MAX_ASSIGNED_PER_USER} items of each kind.` }, { status: 400 });
  }

  const liveWarehouses = new Set(effectiveWarehouseList().map((warehouse) => warehouse.id));
  const liveFloors = new Set(readSitesConfig().floors.map((floor) => floor.id));
  const badWarehouse = warehouseIds.find((id) => !liveWarehouses.has(id));
  const badFloor = floorIds.find((id) => !liveFloors.has(id));
  if (badWarehouse || badFloor) {
    return NextResponse.json({ error: "One of the chosen warehouses or floors no longer exists. Reload and try again." }, { status: 400 });
  }

  const map = readSiteAssignments();
  if (warehouseIds.length === 0 && floorIds.length === 0) {
    delete map[String(userId)];
  } else {
    map[String(userId)] = { warehouseIds, floorIds };
  }
  const saved = writeSiteAssignments(map);

  logAudit(
    user,
    "sites.assign",
    "users",
    `${target.name}: ${warehouseIds.length} warehouse(s), ${floorIds.length} floor(s) assigned`,
  );
  return NextResponse.json({ assignments: saved });
}
