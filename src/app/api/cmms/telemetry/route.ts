import { NextResponse } from "next/server";
import { db } from "@/db";
import { assets, maintenanceLogs } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { authorize } from "@/lib/auth";

/** Powered plant fleet — generators and other engine-driven assets. */
export async function GET(request: Request) {
  const { error: authError } = await authorize("cmms:read");
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const onlyGenerators = url.searchParams.get("generatorsOnly") !== "false";

    const all = await db.select().from(assets).orderBy(asc(assets.assetTag));
    const fleet = onlyGenerators
      ? all.filter((a) => a.assetType === "Generators" || a.ratingKva > 0)
      : all;

    const enriched = fleet.map((a) => {
      const interval = Math.max(1, a.serviceIntervalHours || 500);
      const sinceService = Math.max(0, (a.runtimeHours || 0) - (a.lastServiceHours || 0));
      const overdue = sinceService >= interval;

      // Health flags mirroring real engine alarm thresholds
      const lowFuel = a.fuelReservePercent <= 25;
      const lowOilPressure = Number(a.oilPressureBar) > 0 && Number(a.oilPressureBar) < 2.5;
      const overloaded = a.loadOutputPercent >= 90;

      return {
        ...a,
        sinceService,
        overdue,
        lowFuel,
        lowOilPressure,
        overloaded,
        alarms: [
          overdue ? "Service overdue" : null,
          lowFuel ? "Low fuel reserve" : null,
          lowOilPressure ? "Low oil pressure" : null,
          overloaded ? "Load above 90%" : null,
        ].filter(Boolean),
      };
    });

    const running = enriched.filter((a) => a.powerStatus === "Running");
    const totalKva = enriched.reduce((s, a) => s + (a.ratingKva || 0), 0);
    const activeLoadKva = running.reduce(
      (s, a) => s + ((a.ratingKva || 0) * (a.loadOutputPercent || 0)) / 100,
      0,
    );

    return NextResponse.json({
      fleet: enriched,
      summary: {
        totalUnits: enriched.length,
        running: running.length,
        standby: enriched.filter((a) => a.powerStatus === "Standby").length,
        maintenanceRequired: enriched.filter((a) => a.powerStatus === "Maintenance Required").length,
        offline: enriched.filter((a) => a.powerStatus === "Offline").length,
        totalCapacityKva: totalKva,
        activeLoadKva: Math.round(activeLoadKva),
        capacityUsedPercent: totalKva > 0 ? Math.round((activeLoadKva / totalKva) * 100) : 0,
        alarmCount: enriched.reduce((s, a) => s + a.alarms.length, 0),
      },
    });
  } catch (error: any) {
    console.error("GET telemetry error:", error);
    return NextResponse.json({ error: error?.message || "Failed to load fleet telemetry" }, { status: 500 });
  }
}

/** Record a new engine diagnostic reading from the console. */
export async function PATCH(request: Request) {
  const { error: authError } = await authorize("cmms:write");
  if (authError) return authError;

  try {
    const body = await request.json();
    const {
      assetId,
      powerStatus,
      loadOutputPercent,
      fuelReservePercent,
      oilPressureBar,
      ratingKva,
      runtimeHours,
      logReading,
      performedById,
    } = body;

    if (!assetId) return NextResponse.json({ error: "Asset ID is required." }, { status: 400 });

    const [asset] = await db.select().from(assets).where(eq(assets.id, Number(assetId)));
    if (!asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });

    const clampPct = (v: any, fallback: number) =>
      v === undefined || v === null || v === "" ? fallback : Math.min(100, Math.max(0, Number(v)));

    const update: any = { telemetryAt: new Date() };
    if (powerStatus !== undefined) update.powerStatus = powerStatus;
    update.loadOutputPercent = clampPct(loadOutputPercent, asset.loadOutputPercent);
    update.fuelReservePercent = clampPct(fuelReservePercent, asset.fuelReservePercent);
    if (oilPressureBar !== undefined && oilPressureBar !== "") {
      update.oilPressureBar = String(Math.max(0, Number(oilPressureBar)));
    }
    if (ratingKva !== undefined && ratingKva !== "") {
      update.ratingKva = Math.max(0, Number(ratingKva));
    }
    if (runtimeHours !== undefined && runtimeHours !== "") {
      update.runtimeHours = Math.max(asset.runtimeHours, Number(runtimeHours));
    }

    const [updated] = await db.update(assets).set(update).where(eq(assets.id, Number(assetId))).returning();

    if (logReading) {
      await db.insert(maintenanceLogs).values({
        assetId: Number(assetId),
        eventType: "Meter Reading",
        description: `Engine diagnostic capture — status ${update.powerStatus ?? asset.powerStatus}, load ${update.loadOutputPercent}%, fuel ${update.fuelReservePercent}%, oil pressure ${update.oilPressureBar ?? asset.oilPressureBar} bar.`,
        runtimeAtEvent: updated.runtimeHours,
        downtimeMinutes: 0,
        partsCost: "0.00",
        laborCost: "0.00",
        performedById: performedById ? Number(performedById) : null,
        resetService: false,
      });
    }

    return NextResponse.json({ success: true, asset: updated });
  } catch (error: any) {
    console.error("PATCH telemetry error:", error);
    return NextResponse.json({ error: error?.message || "Failed to save telemetry" }, { status: 500 });
  }
}
