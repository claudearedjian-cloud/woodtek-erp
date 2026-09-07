import { NextResponse } from "next/server";
import { db } from "@/db";
import { attendance, users, shifts } from "@/db/schema";
import { eq, and, gte, lte, isNull, desc, asc } from "drizzle-orm";
import { authorize } from "@/lib/auth";

/**
 * Time & attendance.
 *  - GET  ?date=YYYY-MM-DD  -> attendance rows that day (Manager: all users; others: only themselves)
 *  - GET  ?from=&to=        -> attendance rows in range (same scoping)
 *  - POST { clockIn: true, shiftId? }     -> clock the current user in (or a manager clocks another: userId?)
 *  - PATCH { clockOut: true, attendanceId? } -> clock out (own open record, or any for Manager)
 */

export async function GET(request: Request) {
  const { error: authError, user } = await authorize("attendance:read");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(request.url);
    const date = url.searchParams.get("date");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const isManager = user.role === "Manager";

    const whereClauses = [];
    if (date) {
      const dayStart = `${date} 00:00:00`;
      const dayEnd = `${date} 23:59:59`;
      whereClauses.push(gte(attendance.clockIn, new Date(dayStart)));
      whereClauses.push(lte(attendance.clockIn, new Date(dayEnd)));
    } else if (from && to) {
      whereClauses.push(gte(attendance.clockIn, new Date(`${from} 00:00:00`)));
      whereClauses.push(lte(attendance.clockIn, new Date(`${to} 23:59:59`)));
    }
    if (!isManager) whereClauses.push(eq(attendance.userId, user.id));

    const rows = await db
      .select({
        id: attendance.id,
        userId: attendance.userId,
        userName: users.name,
        userRole: users.role,
        avatarColor: users.avatarColor,
        shiftId: attendance.shiftId,
        shiftName: shifts.name,
        clockIn: attendance.clockIn,
        clockOut: attendance.clockOut,
        status: attendance.status,
        notes: attendance.notes,
      })
      .from(attendance)
      .leftJoin(users, eq(attendance.userId, users.id))
      .leftJoin(shifts, eq(attendance.shiftId, shifts.id))
      .where(whereClauses.length > 0 ? and(...whereClauses) : undefined)
      .orderBy(desc(attendance.clockIn));

    // Compute worked minutes per row
    const enriched = rows.map((r) => {
      const workedMin = r.clockOut ? Math.max(0, Math.round((new Date(r.clockOut).getTime() - new Date(r.clockIn).getTime()) / 60000)) : null;
      return { ...r, workedMinutes: workedMin };
    });

    return NextResponse.json(enriched);
  } catch (error: any) {
    console.error("GET attendance error:", error);
    return NextResponse.json({ error: error?.message || "Failed to load attendance" }, { status: 500 });
  }
}

/** Clock in: current user, or Manager can clock another user in. */
export async function POST(request: Request) {
  const { error: authError, user } = await authorize("attendance:write");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    let targetUserId = user.id;
    if (body.userId && user.role === "Manager") targetUserId = Number(body.userId);
    else if (body.userId && Number(body.userId) !== Number(user.id)) {
      return NextResponse.json({ error: "Only a Manager can clock another user in." }, { status: 403 });
    }

    // Prevent double clock-in: reject if there is an open record (clock_out IS NULL)
    const [open] = await db
      .select({ id: attendance.id })
      .from(attendance)
      .where(and(eq(attendance.userId, targetUserId), isNull(attendance.clockOut)))
      .limit(1);
    if (open) {
      return NextResponse.json({ error: "This user is already clocked in. Clock out first." }, { status: 409 });
    }

    const [created] = await db
      .insert(attendance)
      .values({
        userId: targetUserId,
        shiftId: body.shiftId ? Number(body.shiftId) : null,
        status: "Present",
        notes: body.notes ? String(body.notes).trim() : null,
      })
      .returning();
    return NextResponse.json(created, { status: 201 });
  } catch (error: any) {
    console.error("POST attendance error:", error);
    return NextResponse.json({ error: error?.message || "Failed to clock in" }, { status: 500 });
  }
}

/** Clock out: close the user's open record (Manager may close anyone's). */
export async function PATCH(request: Request) {
  const { error: authError, user } = await authorize("attendance:write");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const isManager = user.role === "Manager";

    let recordId = Number(body.attendanceId || 0);
    if (!recordId) {
      // Find the caller's own open record (or, for Manager, optionally targetUserId's)
      let targetUserId = user.id;
      if (body.userId && isManager) targetUserId = Number(body.userId);
      const [open] = await db
        .select({ id: attendance.id })
        .from(attendance)
        .where(and(eq(attendance.userId, targetUserId), isNull(attendance.clockOut)))
        .orderBy(desc(attendance.clockIn))
        .limit(1);
      if (!open) return NextResponse.json({ error: "No open clock-in record found for this user." }, { status: 404 });
      recordId = open.id;
    }

    // Non-managers may only close their own record
    if (!isManager) {
      const [rec] = await db.select({ userId: attendance.userId }).from(attendance).where(eq(attendance.id, recordId));
      if (!rec) return NextResponse.json({ error: "Attendance record not found." }, { status: 404 });
      if (Number(rec.userId) !== Number(user.id)) {
        return NextResponse.json({ error: "You can only clock out your own record." }, { status: 403 });
      }
    }

    const [updated] = await db
      .update(attendance)
      .set({ clockOut: new Date() })
      .where(eq(attendance.id, recordId))
      .returning();
    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("PATCH attendance error:", error);
    return NextResponse.json({ error: error?.message || "Failed to clock out" }, { status: 500 });
  }
}
