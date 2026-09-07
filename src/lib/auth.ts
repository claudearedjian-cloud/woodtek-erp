import "server-only";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { can, deniedMessage, type Action } from "@/lib/permissions";

export const SESSION_COOKIE = "woodtek_session";
const MAX_AGE_SECONDS = 60 * 60 * 12; // one working shift + margin
const BCRYPT_ROUNDS = 10;

/**
 * Signing secret. In production AUTH_SECRET must be set — otherwise every
 * restart would silently invalidate sessions and, worse, a predictable
 * fallback would let anyone forge a cookie.
 */
function getSecret(): string {
  const fromEnv = process.env.AUTH_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;

  // Safe first-run fallback for development: never leave a fresh
  // installation unable to create its Owner. A permanent AUTH_SECRET
  // is still strongly recommended because this in-memory key changes
  // after every server restart, invalidating sessions.
  const g = globalThis as typeof globalThis & { __woodtekDevSecret?: string };
  if (!g.__woodtekDevSecret) {
    g.__woodtekDevSecret = randomBytes(32).toString("base64url");
    if (process.env.NODE_ENV === "production") {
      // Refuse to start in production without a real AUTH_SECRET.
      // This prevents accidental production deployments with the
      // ephemeral key (which would log everyone out on every restart).
      console.error(
        "[auth] FATAL: AUTH_SECRET is not set in production. " +
        "Refusing to start. Generate one with: openssl rand -base64 32",
      );
      throw new Error("AUTH_SECRET is required in production");
    } else {
      console.warn(
        "[auth] AUTH_SECRET missing — generated an ephemeral in-memory key. Sessions will not survive a restart.",
      );
    }
  }
  return g.__woodtekDevSecret;
}

export type SessionUser = {
  id: number;
  name: string;
  email: string;
  role: string;
  avatarColor: string;
};

// ---------------------------------------------------------------- PIN hashing

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(String(pin), BCRYPT_ROUNDS);
}

/** Accepts a bcrypt hash; transparently upgrades any legacy plaintext PIN. */
export async function verifyPin(plain: string, stored: string, userId?: number): Promise<boolean> {
  if (!stored) return false;

  const looksHashed = stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$");

  if (looksHashed) return bcrypt.compare(String(plain), stored);

  // Legacy plaintext row (pre-hardening). Compare in constant time, then upgrade.
  const a = Buffer.from(String(plain));
  const b = Buffer.from(stored);
  const match = a.length === b.length && timingSafeEqual(a, b);
  if (match && userId) {
    try {
      await db.update(users).set({ pin: await hashPin(plain) }).where(eq(users.id, userId));
    } catch {
      /* best-effort upgrade; failure must not block a valid login */
    }
  }
  return match;
}

export function isPinHashed(stored: string | null | undefined): boolean {
  return !!stored && (stored.startsWith("$2a$") || stored.startsWith("$2b$") || stored.startsWith("$2y$"));
}

// ---------------------------------------------------------------- Session token

export function createSessionToken(userId: number): string {
  const payload = Buffer.from(JSON.stringify({ uid: userId, iat: Date.now() })).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(token: string | undefined | null): number | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = createHmac("sha256", getSecret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof data?.uid !== "number") return null;
    if (typeof data?.iat !== "number" || Date.now() - data.iat > MAX_AGE_SECONDS * 1000) return null;
    return data.uid;
  } catch {
    return null;
  }
}

/**
 * `Secure` cookies are only sent back over HTTPS. A factory server on a plain
 * HTTP LAN would therefore be unable to log anyone in, so this is explicit:
 *   AUTH_COOKIE_SECURE=true   force on  (behind HTTPS / a TLS reverse proxy)
 *   AUTH_COOKIE_SECURE=false  force off (trusted LAN over plain HTTP)
 *   AUTH_COOKIE_SECURE=auto   follow the request protocol (default)
 */
export function sessionCookieOptions(isHttps?: boolean) {
  const mode = (process.env.AUTH_COOKIE_SECURE ?? "auto").toLowerCase();
  const secure = mode === "true" ? true : mode === "false" ? false : Boolean(isHttps);

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  };
}

/** Best-effort HTTPS detection behind a reverse proxy. */
export function requestIsHttps(request: Request): boolean {
  const proto = request.headers.get("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- Current user

export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const uid = verifySessionToken(store.get(SESSION_COOKIE)?.value);
  if (!uid) return null;

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      avatarColor: users.avatarColor,
      active: users.active,
    })
    .from(users)
    .where(eq(users.id, uid));

  const found = rows[0];
  if (!found || !found.active) return null;
  return {
    id: found.id,
    name: found.name,
    email: found.email,
    role: found.role,
    avatarColor: found.avatarColor,
  };
}

/**
 * Gate an API route.
 *   const { user, error } = await authorize("orders:write");
 *   if (error) return error;
 */
export async function authorize(
  action?: Action,
): Promise<{ user: SessionUser; error: null } | { user: null; error: NextResponse }> {
  const user = await getSessionUser();
  if (!user) {
    return {
      user: null,
      error: NextResponse.json({ error: "You are signed out. Please sign in again." }, { status: 401 }),
    };
  }
  if (action && !can(user.role, action)) {
    return { user: null, error: NextResponse.json({ error: deniedMessage(user.role, action) }, { status: 403 }) };
  }
  return { user, error: null };
}

// ---------------------------------------------------------------- Brute force

type Attempt = { count: number; blockedUntil: number };
const attempts = new Map<string, Attempt>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000;

export function checkRateLimit(key: string): { blocked: boolean; retryAfterSec: number } {
  const rec = attempts.get(key);
  if (rec && rec.blockedUntil > Date.now()) {
    return { blocked: true, retryAfterSec: Math.ceil((rec.blockedUntil - Date.now()) / 1000) };
  }
  return { blocked: false, retryAfterSec: 0 };
}

export function recordFailure(key: string) {
  const rec = attempts.get(key) ?? { count: 0, blockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_ATTEMPTS) {
    rec.blockedUntil = Date.now() + LOCKOUT_MS;
    rec.count = 0;
  }
  attempts.set(key, rec);
}

export function clearFailures(key: string) {
  attempts.delete(key);
}
