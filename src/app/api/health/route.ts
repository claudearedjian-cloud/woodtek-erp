import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

// Baked in at build time by scripts/build-prod.cjs
// (NEXT_PUBLIC_WOODTEK_BUILD = `git rev-parse --short HEAD`). Reporting it here
// is what lets installer\apply-update.ps1 VERIFY an update instead of asking
// someone to open Settings and read the number by eye. It is null when the
// bundle was built with `npx next build` directly instead of build-prod.cjs.
const BUILD = process.env.NEXT_PUBLIC_WOODTEK_BUILD || null;

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, build: BUILD });
  } catch {
    return Response.json({ ok: false, build: BUILD }, { status: 500 });
  }
}
