import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";

/**
 * PUBLIC — the sign-in screen needs to render the employee picker before a
 * session exists. Deliberately exposes only what is shown on that screen:
 * display name, role and avatar colour. Never the PIN, e-mail or notes.
 */
export async function GET() {
  try {
    const roster = await db
      .select({
        id: users.id,
        name: users.name,
        role: users.role,
        avatarColor: users.avatarColor,
      })
      .from(users)
      .where(eq(users.active, true))
      .orderBy(asc(users.role), asc(users.name));

    return NextResponse.json(roster);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to load roster";
    console.error("GET roster error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
