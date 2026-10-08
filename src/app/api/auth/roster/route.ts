import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { ensureUsersLoginColumn } from "@/lib/usersSchema.server";
import { approvedLeaveMap, loginBlockingEnabled } from "@/lib/hrLeaveGate.server";

/**
 * PUBLIC — the sign-in screen needs to render the employee picker before a
 * session exists. Deliberately exposes only what is shown on that screen:
 * display name, role and avatar colour. Never the PIN, e-mail or notes.
 * HR-only employees (can_login = false) are hidden: they have no sign-in.
 */
export async function GET() {
  try {
    await ensureUsersLoginColumn();
    const roster = await db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        avatarColor: users.avatarColor,
      })
      .from(users)
      .where(and(eq(users.active, true), eq(users.canLogin, true)))
      .orderBy(asc(users.role), asc(users.name));

    // Mark (never explain) employees whose sign-in is blocked by approved
    // leave, so the picker can warn before a PIN is typed. The leave TYPE stays
    // off this public endpoint — it is only disclosed by the 403 the sign-in
    // itself returns, i.e. to someone who already knows the PIN.
    const onLeave = loginBlockingEnabled()
      ? await approvedLeaveMap(roster.map((entry) => entry.id), undefined, "login")
      : new Map();
    return NextResponse.json(
      roster.map((entry) => ({
        ...entry,
        onLeave: onLeave.has(entry.id),
        leaveUntil: onLeave.get(entry.id)?.endDate ?? null,
      })),
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load roster";
    console.error("GET roster error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
