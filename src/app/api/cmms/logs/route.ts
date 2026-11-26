import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { assets, maintenanceLogs } from "@/db/schema";
import { authorize } from "@/lib/auth";

function positiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function nonNegativeNumber(value: unknown, fallback = 0): number | null {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** Record a maintenance event and, when requested, reset the service baseline. */
export async function POST(request: Request) {
  const { user, error: authError } = await authorize("cmms:write");
  if (authError || !user) {
    return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
    }

    const assetId = positiveId(body.assetId);
    if (!assetId) return NextResponse.json({ error: "A valid asset is required." }, { status: 400 });

    const eventType = String(body.eventType ?? "").trim().slice(0, 120);
    const description = String(body.description ?? "").trim();
    if (!eventType) return NextResponse.json({ error: "Select an operation type." }, { status: 400 });
    if (!description) return NextResponse.json({ error: "Add remarks describing the work performed." }, { status: 400 });

    const [asset] = await db.select().from(assets).where(eq(assets.id, assetId));
    if (!asset) return NextResponse.json({ error: "Asset not found." }, { status: 404 });

    const meterReading = nonNegativeNumber(body.runtimeAtEvent, asset.runtimeHours);
    if (meterReading === null) {
      return NextResponse.json({ error: "Machine meter reading must be a valid non-negative number." }, { status: 400 });
    }
    const runtimeAtEvent = Math.round(meterReading);
    if (runtimeAtEvent < asset.runtimeHours) {
      return NextResponse.json({
        error: `Meter reading (${runtimeAtEvent} hrs) cannot be lower than the saved machine meter (${asset.runtimeHours} hrs).`,
      }, { status: 400 });
    }

    const downtime = nonNegativeNumber(body.downtimeMinutes);
    const partsCost = nonNegativeNumber(body.partsCost);
    const laborCost = nonNegativeNumber(body.laborCost);
    if (downtime === null || partsCost === null || laborCost === null) {
      return NextResponse.json({ error: "Downtime and costs must be non-negative numbers." }, { status: 400 });
    }

    const resetService = body.resetService === true;
    const checklistJson = body.checklistJson ?? body.checklist ?? null;
    const [created] = await db.transaction(async (tx) => {
      const [log] = await tx.insert(maintenanceLogs).values({
        assetId,
        eventType,
        description,
        runtimeAtEvent,
        downtimeMinutes: Math.round(downtime),
        partsCost: partsCost.toFixed(2),
        laborCost: laborCost.toFixed(2),
        performedById: user.id,
        resetService,
        checklistJson: checklistJson && typeof checklistJson === "object" && !Array.isArray(checklistJson)
          ? checklistJson
          : null,
      }).returning();

      await tx.update(assets)
        .set({
          runtimeHours: sql`GREATEST(${assets.runtimeHours}, ${runtimeAtEvent})`,
          ...(resetService ? { lastServiceHours: runtimeAtEvent } : {}),
        })
        .where(eq(assets.id, assetId));

      return [log];
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    console.error("POST CMMS maintenance log error:", error);
    return NextResponse.json({ error: "Failed to record the maintenance event." }, { status: 500 });
  }
}

/** Delete a maintenance entry (restricted to CMMS writers). */
export async function DELETE(request: Request) {
  const { error: authError } = await authorize("cmms:write");
  if (authError) return authError;

  const logId = positiveId(new URL(request.url).searchParams.get("logId"));
  if (!logId) return NextResponse.json({ error: "A valid maintenance log ID is required." }, { status: 400 });

  try {
    const [deleted] = await db.delete(maintenanceLogs)
      .where(eq(maintenanceLogs.id, logId))
      .returning({ id: maintenanceLogs.id });
    if (!deleted) return NextResponse.json({ error: "Maintenance entry not found." }, { status: 404 });
    return NextResponse.json({ success: true, id: deleted.id });
  } catch (error) {
    console.error("DELETE CMMS maintenance log error:", error);
    return NextResponse.json({ error: "Failed to delete the maintenance entry." }, { status: 500 });
  }
}
