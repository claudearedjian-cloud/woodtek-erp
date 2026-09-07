import { NextResponse } from "next/server";
import { db } from "@/db";
import { downtimeEvents, machines } from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { listDowntimeEventsForUser } from "@/lib/dataAccess";

export const DOWNTIME_REASONS = [
  "Mechanical Failure",
  "Electrical Fault",
  "Material Shortage",
  "Setup & Changeover",
  "Operator Unavailable",
  "Quality Issue",
  "Other",
];

export async function GET(request: Request) {
  const { user, error: authError } = await authorize("downtime:read");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const rows = await listDowntimeEventsForUser(user, {
      machineId: url.searchParams.get("machineId") ? Number(url.searchParams.get("machineId")) : undefined,
      activeOnly: url.searchParams.get("activeOnly") === "true",
    });
    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("GET downtime error:", error);
    return NextResponse.json({ error: error?.message || "Failed to fetch downtime records" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { user, error: authError } = await authorize("downtime:write");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const machineId = Number(body.machineId);
    const reason = String(body.reason ?? "").trim();

    if (!Number.isInteger(machineId) || machineId <= 0) {
      return NextResponse.json({ error: "A machine is required to log downtime." }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: "A downtime reason is required." }, { status: 400 });
    }

    const [machine] = await db.select({ id: machines.id, code: machines.code }).from(machines).where(eq(machines.id, machineId));
    if (!machine) {
      return NextResponse.json({ error: "Machine not found." }, { status: 404 });
    }

    // A machine can only have one open downtime event at a time.
    const [openEvent] = await db
      .select({ id: downtimeEvents.id })
      .from(downtimeEvents)
      .where(and(eq(downtimeEvents.machineId, machineId), isNull(downtimeEvents.endedAt)));
    if (openEvent) {
      return NextResponse.json(
        { error: `${machine.code} already has an open downtime event. End it before starting a new one.` },
        { status: 409 },
      );
    }

    const [created] = await db.insert(downtimeEvents).values({
      machineId,
      orderId: body.orderId ? Number(body.orderId) : null,
      operationId: body.operationId ? Number(body.operationId) : null,
      reason,
      startedAt: body.startedAt ? new Date(body.startedAt) : new Date(),
      endedAt: null,
      durationMinutes: 0,
      operatorId: user.id,
      notes: body.notes ? String(body.notes).trim() : null,
    }).returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    console.error("POST downtime error:", error);
    return NextResponse.json({ error: error?.message || "Failed to start downtime" }, { status: 500 });
  }
}
