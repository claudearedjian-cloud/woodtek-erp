import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Edge guard: rejects unauthenticated API traffic before it reaches a route
 * handler. This is defence-in-depth — each route still calls authorize() for
 * the real role check — but it means a newly added route is closed by default
 * instead of accidentally public.
 *
 * Only the cookie's PRESENCE and shape are checked here; the HMAC signature is
 * verified in the Node runtime by lib/auth (node:crypto is unavailable on edge).
 */
const PUBLIC_API = new Set([
  "/api/auth", // sign in / sign out / whoami
  "/api/auth/roster", // employee picker shown on the sign-in screen
  "/api/bootstrap", // first owner creation; route closes itself after first account
  "/api/health", // container healthcheck
  // PIMS folder scan: allowed through the edge because the route itself
  // checks for loopback origin (the local watcher) or a manager session.
  "/api/pims/scan",
  // Seeding is allowed through the edge because the route itself permits it
  // ONLY while the users table is empty (first-run bootstrap); afterwards it
  // demands the admin:seed capability.
  "/api/seed",
]);

export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/")) return NextResponse.next();
  if (PUBLIC_API.has(pathname)) return NextResponse.next();

  const token = request.cookies.get("woodtek_session")?.value;
  const looksValid = !!token && token.split(".").length === 2 && token.length > 20;

  if (!looksValid) {
    return NextResponse.json({ error: "You are signed out. Please sign in again." }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
