import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  SESSION_COOKIE,
  createSessionToken,
  sessionCookieOptions,
  requestIsHttps,
  getSessionUser,
  verifyPin,
  checkRateLimit,
  recordFailure,
  clearFailures,
} from "@/lib/auth";

/** GET /api/auth — who am I? Used to restore the session after a page refresh. */
export async function GET() {
  // Demo conveniences (quick-login buttons, printed PINs) are development-only.
  // A production build never advertises credentials.
  const demoMode = process.env.NODE_ENV !== "production" && process.env.WOODTEK_DEMO !== "off";
  const user = await getSessionUser();
  return NextResponse.json({ user: user ?? null, demoMode });
}

/** POST /api/auth — sign in with userId (or email) + 4-digit PIN. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const userId = Number(body.userId);
    const email = String(body.email ?? "").trim().toLowerCase();
    const pin = String(body.pin ?? "").trim();

    if (!/^\d{4}$/.test(pin)) {
      return NextResponse.json({ error: "Please enter a valid four-digit PIN." }, { status: 400 });
    }

    // Throttle by the identifier being attacked, plus the client IP.
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "local";
    const rateKey = `${ip}:${Number.isInteger(userId) ? userId : email || "anon"}`;

    const limit = checkRateLimit(rateKey);
    if (limit.blocked) {
      return NextResponse.json(
        { error: `Too many failed attempts. Try again in ${limit.retryAfterSec} second(s).` },
        { status: 429 },
      );
    }

    // Resolve the candidate account.
    let candidate: typeof users.$inferSelect | undefined;
    if (Number.isInteger(userId) && userId > 0) {
      [candidate] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.active, true)));
    } else if (email) {
      [candidate] = await db.select().from(users).where(and(eq(users.email, email), eq(users.active, true)));
    }

    if (!candidate) {
      recordFailure(rateKey);
      return NextResponse.json({ error: "Incorrect PIN or inactive employee account." }, { status: 401 });
    }

    const ok = await verifyPin(pin, candidate.pin, candidate.id);
    if (!ok) {
      recordFailure(rateKey);
      return NextResponse.json({ error: "Incorrect PIN or inactive employee account." }, { status: 401 });
    }

    clearFailures(rateKey);

    const safeUser = {
      id: candidate.id,
      name: candidate.name,
      email: candidate.email,
      role: candidate.role,
      avatarColor: candidate.avatarColor,
    };

    const response = NextResponse.json({ user: safeUser });
    response.cookies.set(
      SESSION_COOKIE,
      createSessionToken(candidate.id),
      sessionCookieOptions(requestIsHttps(request)),
    );
    return response;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Authentication failed";
    console.error("Authentication error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/auth — sign out. */
export async function DELETE() {
  const response = NextResponse.json({ success: true });
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
