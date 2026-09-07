import { NextResponse } from "next/server";
import { db } from "@/db";
import { shiftAssignments, shifts, users, machines } from "@/db/schema";
import { eq, and, gte, lte, asc, inArray } from "drizzle-orm";
import { authorize } from "@/lib/auth";

/**
 * Shift assignments = the production calendar: who works which shift
 * on which day (optionally at which machine/station).
 */

/** GET ?from=YYYY-MM-DD&to=YYYY-MM-DD — assignments in a date range. */
export async function GET(request: Request) {
  const { error: authError } = await authorize("shifts:read");
  if (authError) return authError;
  try {
    const url = new URL(request.url);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (!from || !to) return NextResponse.json({ error: "from and to dates are required (YYYY-MM-DD)." }, { status: 400 });

    const rows = await db
      .select({
        id: shiftAssignments.id,
        userId: shiftAssignments.userId,
        userName: users.name,
        userRole: users.role,
        avatarColor: users.avatarColor,
        shiftId: shiftAssignments.shiftId,
        shiftName: shifts.name,
        shiftStart: shifts.startTime,
        shiftEnd: shifts.endTime,
        shiftColor: shifts.color,
        workDate: shiftAssignments.workDate,
        machineId: shiftAssignments.machineId,
        machineCode: machines.code,
        machineName: machines.name,
        notes: shiftAssignments.notes,
      })
      .from(shiftAssignments)
      .leftJoin(users, eq(shiftAssignments.userId, users.id))
      .leftJoin(shifts, eq(shiftAssignments.shiftId, shifts.id))
      .leftJoin(machines, eq(shiftAssignments.machineId, machines.id))
      .where(
        and(
          gte(shiftAssignments.workDate, from),
          lte(shiftAssignments.workDate, to),
        ),
      )
      .orderBy(asc(shiftAssignments.workDate), asc(shifts.startTime));

    return NextResponse.json(rows);
  } catch (error: any) {
    console.error("GET shift assignments error:", error);
    return NextResponse.json({ error: error?.message || "Failed to load shift assignments" }, { status: 500 });
  }
}

/** POST { userId, shiftId, workDate, machineId?, notes? } — upsert (one assignment per user per day). */
export async function POST(request: Request) {
  const { error: authError } = await authorize("shifts:write");
  if (authError) return authError;
  try {
    const body = await request.json();
    const userId = Number(body.userId);
    const shiftId = Number(body.shiftId);
    const workDate = String(body.workDate ?? "");
    if (!userId || !shiftId) return NextResponse.json({ error: "userId and shiftId are required." }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return NextResponse.json({ error: "workDate must be YYYY-MM-DD." }, { status: 400 });

    const [existing] = await db
      .select({ id: shiftAssignments.id })
      .from(shiftAssignments)
      .where(and(eq(shiftAssignments.userId, userId), eq(shiftAssignments.workDate, workDate)))
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(shiftAssignments)
        .set({
          shiftId,
          machineId: body.machineId ? Number(body.machineId) : null,
          notes: body.notes ? String(body.notes).trim() : null,
        })
        .where(eq(shiftAssignments.id, existing.id))
        .returning();
      return NextResponse.json(updated);
    }

    const [created] = await db
      .insert(shiftAssignments)
      .values({
        userId,
        shiftId,
        workDate,
        machineId: body.machineId ? Number(body.machineId) : null,
        notes: body.notes ? String(body.notes).trim() : null,
      })
      .returning();
    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    console.error("POST shift assignment error:", error);
    return NextResponse.json({ error: error?.message || "Failed to save shift assignment" }, { status: 500 });
  }
}

/** DELETE ?id= — remove an assignment (Manager only). */
export async function DELETE(request: Request) {
  const { error: authError } = await authorize("shifts:write");
  if (authError) return authError;
  try {
    const url = new URL(request.url);
    const id = Number(url.searchParams.get("id"));
    if (!id) return NextResponse.json({ error: "Assignment id is required." }, { status: 400 });
    await db.delete(shiftAssignments).where(eq(shiftAssignments.id, id));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE shift assignment error:", error);
    return NextResponse.json({ error: error?.message || "Failed to remove assignment" }, { status: 500 });
  }
}
