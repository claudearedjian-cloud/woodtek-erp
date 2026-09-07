import { NextResponse } from "next/server";
import { db } from "@/db";
import { qualityEvents, orders } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { listQualityEventsForUser } from "@/lib/dataAccess";

const EVENT_TYPES = ["scrap", "rework"] as const;

export async function GET(request: Request) {
  const { user, error: authError } = await authorize("quality:read");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const rows = await listQualityEventsForUser(user, {
      eventType: url.searchParams.get("type") ?? undefined,
      disposition: url.searchParams.get("disposition") ?? undefined,
      machineId: url.searchParams.get("machineId") ? Number(url.searchParams.get("machineId")) : undefined,
      orderId: url.searchParams.get("orderId") ? Number(url.searchParams.get("orderId")) : undefined,
    });

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("GET quality events error:", error);
    return NextResponse.json({ error: error?.message || "Failed to fetch scrap & rework events" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { user, error: authError } = await authorize("quality:write");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const eventType = String(body.eventType ?? "").toLowerCase();
    const orderId = Number(body.orderId);
    const quantity = Math.max(1, Math.floor(Number(body.quantity ?? 1)));
    const reason = String(body.reason ?? "").trim();

    if (!EVENT_TYPES.includes(eventType as any)) {
      return NextResponse.json({ error: "Event type must be 'scrap' or 'rework'." }, { status: 400 });
    }
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "A valid order is required." }, { status: 400 });
    }
    if (!reason) {
      return NextResponse.json({ error: "A defect / rework reason is required." }, { status: 400 });
    }

    // Validate the order exists (and keep FK errors friendly).
    const [order] = await db.select({ id: orders.id }).from(orders).where(eq(orders.id, orderId));
    if (!order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    const disposition = body.disposition
      ? String(body.disposition)
      : eventType === "scrap"
        ? "Scrapped"
        : "Open";

    const [created] = await db.insert(qualityEvents).values({
      orderId,
      operationId: body.operationId ? Number(body.operationId) : null,
      machineId: body.machineId ? Number(body.machineId) : null,
      eventType,
      quantity,
      unit: String(body.unit ?? "pcs").trim() || "pcs",
      reason,
      disposition,
      estimatedCost: body.estimatedCost !== undefined ? String(body.estimatedCost) : "0.00",
      recordedById: user.id,
      notes: body.notes ? String(body.notes).trim() : null,
      resolvedAt: disposition === "Scrapped" || disposition === "Reworked & Passed" ? new Date() : null,
    }).returning();

    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    console.error("POST quality event error:", error);
    return NextResponse.json({ error: error?.message || "Failed to record scrap / rework event" }, { status: 500 });
  }
}
