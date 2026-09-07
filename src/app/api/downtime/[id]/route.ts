import { NextResponse } from "next/server";
import { db } from "@/db";
import { downtimeEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error: authError } = await authorize("downtime:write");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await context.params;
    const eventId = Number(id);
    const body = await request.json();

    const [event] = await db.select().from(downtimeEvents).where(eq(downtimeEvents.id, eventId));
    if (!event) {
      return NextResponse.json({ error: "Downtime event not found." }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.reason !== undefined) updateData.reason = String(body.reason).trim() || event.reason;
    if (body.notes !== undefined) updateData.notes = String(body.notes).trim() || null;

    // Ending a stoppage: stamp ended_at and compute the duration in minutes.
    const shouldEnd = body.end === true || body.endedAt !== undefined;
    if (shouldEnd && !event.endedAt) {
      const endedAt = body.endedAt ? new Date(body.endedAt) : new Date();
      if (Number.isNaN(endedAt.getTime())) {
        return NextResponse.json({ error: "End time must be a valid date." }, { status: 400 });
      }
      const started = new Date(event.startedAt);
      if (endedAt <= started) {
        return NextResponse.json({ error: "End time must be later than the start time." }, { status: 400 });
      }
      updateData.endedAt = endedAt;
      updateData.durationMinutes = Math.max(0, Math.round((endedAt.getTime() - started.getTime()) / 60000));
    } else if (shouldEnd && event.endedAt) {
      return NextResponse.json({ error: "This downtime event is already closed." }, { status: 409 });
    }

    if (body.startedAt !== undefined) {
      const startedAt = new Date(body.startedAt);
      if (Number.isNaN(startedAt.getTime())) {
        return NextResponse.json({ error: "Start time must be a valid date." }, { status: 400 });
      }
      updateData.startedAt = startedAt;
    }

    const [updated] = await db
      .update(downtimeEvents)
      .set(updateData)
      .where(eq(downtimeEvents.id, eventId))
      .returning();

    return NextResponse.json(updated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update downtime event";
    console.error("PATCH downtime error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error: authError } = await authorize("downtime:write");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only managers may delete a downtime record.
  if (user.role !== "Manager") {
    return NextResponse.json({ error: "Only a Manager can delete downtime records." }, { status: 403 });
  }

  try {
    const { id } = await context.params;
    const eventId = Number(id);

    const [existing] = await db.select().from(downtimeEvents).where(eq(downtimeEvents.id, eventId));
    if (!existing) {
      return NextResponse.json({ error: "Downtime event not found." }, { status: 404 });
    }

    await db.delete(downtimeEvents).where(eq(downtimeEvents.id, eventId));
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to delete downtime event";
    console.error("DELETE downtime error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
