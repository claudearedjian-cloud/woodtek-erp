import { NextResponse } from "next/server";
import { db } from "@/db";
import { qualityEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";

const RESOLVED_DISPOSITIONS = new Set(["Reworked & Passed", "Scrapped"]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error: authError } = await authorize("quality:write");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await context.params;
    const eventId = Number(id);
    const body = await request.json();

    const [event] = await db.select().from(qualityEvents).where(eq(qualityEvents.id, eventId));
    if (!event) {
      return NextResponse.json({ error: "Quality event not found." }, { status: 404 });
    }

    const updateData: Record<string, unknown> = {};
    if (body.disposition !== undefined) updateData.disposition = String(body.disposition);
    if (body.notes !== undefined) updateData.notes = String(body.notes).trim() || null;
    if (body.reason !== undefined) updateData.reason = String(body.reason).trim() || event.reason;
    if (body.quantity !== undefined) updateData.quantity = Math.max(0, Math.floor(Number(body.quantity)));
    if (body.estimatedCost !== undefined) updateData.estimatedCost = String(body.estimatedCost);

    // Resolution semantics: when a disposition is a terminal state, close it.
    if (updateData.disposition && RESOLVED_DISPOSITIONS.has(String(updateData.disposition))) {
      updateData.resolvedAt = new Date();
    } else if (updateData.disposition && !RESOLVED_DISPOSITIONS.has(String(updateData.disposition))) {
      updateData.resolvedAt = null;
    }

    const [updated] = await db
      .update(qualityEvents)
      .set(updateData)
      .where(eq(qualityEvents.id, eventId))
      .returning();

    return NextResponse.json(updated);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to update quality event";
    console.error("PATCH quality event error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error: authError } = await authorize("quality:write");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only managers may remove a quality record (the audit trail matters).
  if (user.role !== "Manager") {
    return NextResponse.json({ error: "Only a Manager can delete quality records." }, { status: 403 });
  }

  try {
    const { id } = await context.params;
    const eventId = Number(id);

    const [existing] = await db.select().from(qualityEvents).where(eq(qualityEvents.id, eventId));
    if (!existing) {
      return NextResponse.json({ error: "Quality event not found." }, { status: 404 });
    }

    await db.delete(qualityEvents).where(eq(qualityEvents.id, eventId));
    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to delete quality event";
    console.error("DELETE quality event error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
