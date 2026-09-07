import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  SESSION_COOKIE,
  createSessionToken,
  hashPin,
  requestIsHttps,
  sessionCookieOptions,
} from "@/lib/auth";

const SAFE_OWNER_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  avatarColor: users.avatarColor,
};

/**
 * Public first-run status. It exposes only whether an account exists.
 * If the schema was not installed, return actionable JSON rather than an HTML 500 page.
 */
export async function GET() {
  try {
    const [existing] = await db.select({ id: users.id }).from(users).limit(1);
    return NextResponse.json({ setupRequired: !existing });
  } catch (error) {
    console.error("Bootstrap status error:", error);
    return NextResponse.json(
      {
        setupRequired: false,
        error: "Database tables are not installed. Run `npx drizzle-kit push`, then reload the application.",
      },
      { status: 503 },
    );
  }
}

/**
 * Create the one and only first Owner account.
 * A PostgreSQL advisory transaction lock prevents two simultaneous requests
 * from both becoming the first owner.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const pin = String(body.pin ?? "").trim();

    if (name.length < 2) {
      return NextResponse.json({ error: "Owner name must contain at least 2 characters." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid owner email address." }, { status: 400 });
    }
    if (!/^\d{4}$/.test(pin)) {
      return NextResponse.json({ error: "Owner PIN must be exactly four digits." }, { status: 400 });
    }
    if (["0000", "1111", "1234", "9999"].includes(pin)) {
      return NextResponse.json({ error: "Choose a less predictable PIN." }, { status: 400 });
    }

    const owner = await db.transaction(async (tx) => {
      // Fixed application-specific lock ID. Held only until this transaction ends.
      await tx.execute(sql`select pg_advisory_xact_lock(874221901)`);

      const [existing] = await tx.select({ id: users.id }).from(users).limit(1);
      if (existing) {
        throw Object.assign(new Error("Initial setup is already complete. Sign in with an existing account."), {
          httpStatus: 409,
        });
      }

      const [created] = await tx
        .insert(users)
        .values({
          name,
          email,
          role: "Manager",
          avatarColor: "bg-blue-600",
          pin: await hashPin(pin),
          active: true,
          notes: "Factory owner account created during first-run setup.",
        })
        .returning(SAFE_OWNER_COLUMNS);

      return created;
    });

    const response = NextResponse.json({ user: owner, setupComplete: true }, { status: 201 });
    response.cookies.set(
      SESSION_COOKIE,
      createSessionToken(owner.id),
      sessionCookieOptions(requestIsHttps(request)),
    );
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Owner setup failed";
    const status = (error as { httpStatus?: number })?.httpStatus ?? 500;
    if (status >= 500) console.error("Bootstrap owner error:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
