// ============================================================================
// Factory structure API — company, branches (locations) and floors.
//
// GET  users:manage — the saved structure.
// PUT  users:manage — replace the structure (full document). Refused when a
//      removed branch still holds warehouses, or when names repeat or a floor
//      has no branch. A removed floor is unassigned from every supervisor.
//
// Warehouses are edited on /api/warehouses (each one has a branchId).
// ============================================================================

import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { sanitizeSitesReport, type SitesConfig } from "@/lib/sites";
import {
  pruneAssignments,
  readSiteAssignments,
  readSitesConfig,
  writeSiteAssignments,
  writeSitesConfig,
} from "@/lib/sites.server";
import { effectiveWarehouseList } from "@/lib/warehouses.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authorize("users:manage");
  if (error) return error;
  return NextResponse.json({ config: readSitesConfig() });
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

  const rawBranches = Array.isArray(body?.branches) ? body.branches : [];
  const rawFloors = Array.isArray(body?.floors) ? body.floors : [];
  if (rawBranches.length === 0) {
    return NextResponse.json({ error: "Keep at least one branch." }, { status: 400 });
  }
  const { config: next, dropped } = sanitizeSitesReport(body);
  if (dropped > 0 || next.branches.length !== rawBranches.length || next.floors.length !== rawFloors.length) {
    return NextResponse.json(
      {
        error:
          "Every branch and floor needs a name. Branch names must be unique across the factory, and floor names must be unique inside their branch.",
      },
      { status: 400 },
    );
  }

  const previous = readSitesConfig();
  const removedBranches = previous.branches.filter((branch) => !next.branches.some((item) => item.id === branch.id));
  if (removedBranches.length > 0) {
    const warehouses = effectiveWarehouseList();
    const blocked = removedBranches.filter((branch) => warehouses.some((warehouse) => warehouse.branchId === branch.id));
    if (blocked.length > 0) {
      return NextResponse.json(
        {
          error: `Move or delete the warehouses in ${blocked.map((branch) => `"${branch.name}"`).join(", ")} first.`,
        },
        { status: 409 },
      );
    }
  }

  const saved: SitesConfig = writeSitesConfig(next);

  // Floors that disappeared lose their supervisor links.
  const liveFloors = new Set(saved.floors.map((floor) => floor.id));
  const liveWarehouses = new Set(effectiveWarehouseList().map((warehouse) => warehouse.id));
  const before = readSiteAssignments();
  const after = pruneAssignments(before, { warehouseIds: liveWarehouses, floorIds: liveFloors });
  if (JSON.stringify(before) !== JSON.stringify(after)) writeSiteAssignments(after);

  logAudit(user, "sites.update", "inventory", `Factory structure saved: ${saved.branches.length} branch(es), ${saved.floors.length} floor(s)`);
  return NextResponse.json({ config: saved });
}
