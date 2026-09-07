import { NextResponse } from "next/server";
import { db } from "@/db";
import { shifts } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { authorize } from "@/lib/auth";

/** List shift definitions (Morning / Afternoon / Night, or factory custom). */
export async function GET() {
  const { error: authError } = await authorize("shifts:read");
  if (authError) return authError;
  try {
    const all = await db.select().from(shifts).orderBy(asc(shifts.startTime));
    return NextResponse.json(all);
  } catch (error: any) {
    console.error("GET shifts error:", error);
    return NextResponse.json({ error: error?.message || "Failed to load shifts" }, { status: 500 });
  }
}

/** Create a shift definition (Manager only). */
export async function POST(request: Request) {
  const { error: authError } = await authorize("shifts:write");
  if (authError) return authError;
  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    const startTime = String(body.startTime ?? "06:00").trim();
    const endTime = String(body.endTime ?? "14:00").trim();
    if (!name) return NextResponse.json({ error: "Shift name is required." }, { status: 400 });
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime)) {
      return NextResponse.json({ error: "Shift times must use HH:MM (24h)." }, { status: 400 });
    }
    const [created] = await db
      .insert(shifts)
      .values({
        name,
        startTime,
        endTime,
        color: String(body.color ?? "bg-amber-500"),
        active: body.active !== false,
      })
      .returning();
    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    console.error("POST shifts error:", error);
    return NextResponse.json({ error: error?.message || "Failed to create shift" }, { status: 500 });
  }
}

/** Delete a shift definition (Manager only). */
export async function DELETE(request: Request) {
  const { error: authError } = await authorize("shifts:write");
  if (authError) return authError;
  try {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "Shift id is required." }, { status: 400 });
    await db.delete(shifts).where(eq(shifts.id, id));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE shifts error:", error);
    return NextResponse.json({ error: error?.message || "Failed to delete shift" }, { status: 500 });
  }
}
