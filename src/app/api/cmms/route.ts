import { NextResponse } from "next/server";
import { db } from "@/db";
import { assets, maintenanceLogs, machines, users } from "@/db/schema";
import { eq, desc, asc } from "drizzle-orm";
import { authorize } from "@/lib/auth";

/** Derive live service state from meter readings. */
function computeAssetState(asset: any) {
  const interval = Math.max(1, asset.serviceIntervalHours || 500);
  const sinceService = Math.max(0, (asset.runtimeHours || 0) - (asset.lastServiceHours || 0));
  const percentUsed = Math.round((sinceService / interval) * 100);
  const hoursRemaining = interval - sinceService;

  let serviceState: string;
  if (asset.status === "Under Maintenance") serviceState = "Under Maintenance";
  else if (asset.status === "Decommissioned") serviceState = "Decommissioned";
  else if (sinceService >= interval) serviceState = "Service Overdue";
  else if (percentUsed >= 85) serviceState = "Service Due";
  else serviceState = "Operational OK";

  return {
    ...asset,
    sinceService,
    percentUsed: Math.min(percentUsed, 150),
    hoursRemaining,
    serviceState,
    isOverdue: serviceState === "Service Overdue",
    isDue: serviceState === "Service Due",
  };
}

export async function GET(request: Request) {
  const { error: authError } = await authorize("cmms:read");
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const assetId = url.searchParams.get("assetId");

    // Single asset detail with its full maintenance history
    if (assetId) {
      const [asset] = await db.select().from(assets).where(eq(assets.id, Number(assetId)));
      if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

      const logs = await db
        .select({
          id: maintenanceLogs.id,
          eventType: maintenanceLogs.eventType,
          description: maintenanceLogs.description,
          runtimeAtEvent: maintenanceLogs.runtimeAtEvent,
          downtimeMinutes: maintenanceLogs.downtimeMinutes,
          partsCost: maintenanceLogs.partsCost,
          laborCost: maintenanceLogs.laborCost,
          resetService: maintenanceLogs.resetService,
          checklistJson: maintenanceLogs.checklistJson,
          createdAt: maintenanceLogs.createdAt,
          performedById: maintenanceLogs.performedById,
          performedByName: users.name,
        })
        .from(maintenanceLogs)
        .leftJoin(users, eq(maintenanceLogs.performedById, users.id))
        .where(eq(maintenanceLogs.assetId, Number(assetId)))
        .orderBy(desc(maintenanceLogs.createdAt));

      return NextResponse.json({ ...computeAssetState(asset), logs });
    }

    // Full registry + analytics
    const allAssets = await db.select().from(assets).orderBy(asc(assets.assetTag));
    const allLogs = await db.select().from(maintenanceLogs);
    const enriched = allAssets.map(computeAssetState);

    const activeAssets = enriched.filter((a) => a.status !== "Decommissioned");
    const totalRuntime = enriched.reduce((sum, a) => sum + (a.runtimeHours || 0), 0);

    // Brand inventory share (donut chart)
    const brandMap = new Map<string, number>();
    for (const a of enriched) {
      brandMap.set(a.brand, (brandMap.get(a.brand) || 0) + 1);
    }
    const brandShare = Array.from(brandMap.entries())
      .map(([brand, count]) => ({ brand, count }))
      .sort((a, b) => b.count - a.count);

    // Site allocation (bar chart)
    const siteMap = new Map<string, number>();
    for (const a of enriched) {
      siteMap.set(a.site, (siteMap.get(a.site) || 0) + 1);
    }
    const siteAllocation = Array.from(siteMap.entries())
      .map(([site, count]) => ({ site, count }))
      .sort((a, b) => b.count - a.count);

    // Asset type distribution
    const typeMap = new Map<string, number>();
    for (const a of enriched) {
      typeMap.set(a.assetType, (typeMap.get(a.assetType) || 0) + 1);
    }

    const totalDowntime = allLogs.reduce((sum, l) => sum + (l.downtimeMinutes || 0), 0);
    const totalMaintCost = allLogs.reduce(
      (sum, l) => sum + parseFloat(l.partsCost || "0") + parseFloat(l.laborCost || "0"),
      0,
    );

    return NextResponse.json({
      assets: enriched,
      kpis: {
        activeFleetAssets: activeAssets.length,
        totalAssets: enriched.length,
        totalRuntimeHours: totalRuntime,
        eventsLogged: allLogs.length,
        configuredSites: siteAllocation.length,
        overdueCount: enriched.filter((a) => a.isOverdue).length,
        dueSoonCount: enriched.filter((a) => a.isDue).length,
        underMaintenanceCount: enriched.filter((a) => a.status === "Under Maintenance").length,
        totalDowntimeMinutes: totalDowntime,
        totalMaintenanceCost: totalMaintCost.toFixed(2),
      },
      brandShare,
      siteAllocation,
      typeDistribution: Array.from(typeMap.entries()).map(([type, count]) => ({ type, count })),
    });
  } catch (error: any) {
    console.error("GET cmms error:", error);
    return NextResponse.json({ error: error?.message || "Failed to fetch CMMS data" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { error: authError } = await authorize("cmms:write");
  if (authError) return authError;

  try {
    const body = await request.json();
    const {
      id,
      assetTag,
      name,
      brand,
      assetType,
      site,
      machineId,
      runtimeHours,
      serviceIntervalHours,
      lastServiceHours,
      status,
      criticality,
      serialNumber,
      notes,
      series,
      productionYear,
      imageUrl,
      ratingKva,
      powerStatus,
    } = body;

    // Image-only patch (used by the Upload New Image control)
    if (id && imageUrl !== undefined && assetTag === undefined && name === undefined) {
      if (imageUrl && String(imageUrl).length > 4_000_000) {
        return NextResponse.json({ error: "Image is too large. Please use a file under 3 MB." }, { status: 413 });
      }
      const [patched] = await db
        .update(assets)
        .set({ imageUrl: imageUrl || null })
        .where(eq(assets.id, Number(id)))
        .returning();
      return NextResponse.json(computeAssetState(patched));
    }

    if (!assetTag || !name) {
      return NextResponse.json({ error: "Asset tag and name are required." }, { status: 400 });
    }

    if (imageUrl && String(imageUrl).length > 4_000_000) {
      return NextResponse.json({ error: "Image is too large. Please use a file under 3 MB." }, { status: 413 });
    }

    const normalizedTag = String(assetTag).trim().toUpperCase();
    const yearValue =
      productionYear === undefined || productionYear === null || productionYear === ""
        ? null
        : Math.max(1900, Math.min(2100, Number(productionYear)));

    if (id) {
      const updateData: any = {
        assetTag: normalizedTag,
        name,
        brand: brand || "Generic",
        assetType: assetType || "Generators",
        site: site || "Main Plant Bay A",
        machineId: machineId ? Number(machineId) : null,
        runtimeHours: Math.max(0, Number(runtimeHours) || 0),
        serviceIntervalHours: Math.max(1, Number(serviceIntervalHours) || 500),
        lastServiceHours: Math.max(0, Number(lastServiceHours) || 0),
        status: status || "Operational",
        criticality: criticality || "Medium",
        serialNumber: serialNumber || null,
        notes: notes || null,
        series: series || null,
        productionYear: yearValue,
      };
      if (imageUrl !== undefined) updateData.imageUrl = imageUrl || null;
      if (ratingKva !== undefined && ratingKva !== "") updateData.ratingKva = Math.max(0, Number(ratingKva));
      if (powerStatus !== undefined) updateData.powerStatus = powerStatus;

      const [updated] = await db.update(assets).set(updateData).where(eq(assets.id, Number(id))).returning();
      return NextResponse.json(computeAssetState(updated));
    }

    // Enforce unique tag
    const existing = await db.select({ id: assets.id }).from(assets).where(eq(assets.assetTag, normalizedTag));
    if (existing.length > 0) {
      return NextResponse.json({ error: `Asset tag ${normalizedTag} already exists.` }, { status: 409 });
    }

    const [created] = await db
      .insert(assets)
      .values({
        assetTag: normalizedTag,
        name,
        brand: brand || "Generic",
        assetType: assetType || "Generators",
        site: site || "Main Plant Bay A",
        machineId: machineId ? Number(machineId) : null,
        runtimeHours: Math.max(0, Number(runtimeHours) || 0),
        serviceIntervalHours: Math.max(1, Number(serviceIntervalHours) || 500),
        lastServiceHours: Math.max(0, Number(lastServiceHours) || 0),
        status: status || "Operational",
        criticality: criticality || "Medium",
        serialNumber: serialNumber || null,
        installedAt: yearValue ? new Date(yearValue, 0, 1) : new Date(),
        notes: notes || null,
        series: series || null,
        productionYear: yearValue,
        imageUrl: imageUrl || null,
        ratingKva: ratingKva ? Math.max(0, Number(ratingKva)) : 0,
        powerStatus: powerStatus || "Standby",
      })
      .returning();

    return NextResponse.json(computeAssetState(created), { status: 201 });
  } catch (error: any) {
    console.error("POST cmms asset error:", error);
    return NextResponse.json({ error: error?.message || "Failed to save asset" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { error: authError } = await authorize("cmms:write");
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const assetId = url.searchParams.get("assetId");
    if (!assetId) return NextResponse.json({ error: "Asset ID required" }, { status: 400 });

    await db.delete(maintenanceLogs).where(eq(maintenanceLogs.assetId, Number(assetId)));
    await db.delete(assets).where(eq(assets.id, Number(assetId)));

    return NextResponse.json({ success: true, message: "Asset and its maintenance history were removed." });
  } catch (error: any) {
    console.error("DELETE cmms asset error:", error);
    return NextResponse.json({ error: error?.message || "Failed to delete asset" }, { status: 500 });
  }
}
