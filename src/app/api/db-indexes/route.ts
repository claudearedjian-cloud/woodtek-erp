// ============================================================================
// Database index check & create (Manager only) — same channel as the
// inventory schema repair (bundle 40f).
// GET  → compare the live database with the index plan (read-only).
// POST → create the missing indexes (CREATE INDEX IF NOT EXISTS, idempotent,
//        never drops/alters anything). Audited as db.indexes.
// ============================================================================

import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { checkDbIndexes, ensureDbIndexes } from "@/lib/dbIndexes.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user, error } = await authorize("users:manage");
  if (error || !user) return error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await checkDbIndexes();
    return NextResponse.json(result);
  } catch (e: unknown) {
    const causeMessage = (e as { cause?: unknown })?.cause;
    const message =
      causeMessage instanceof Error
        ? `Index check failed: ${causeMessage.message}`
        : e instanceof Error
          ? e.message
          : "Index check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  const { user, error } = await authorize("users:manage");
  if (error || !user) return error ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await ensureDbIndexes();
    logAudit(
      { id: user.id, name: user.name, role: user.role },
      "db.indexes",
      "system",
      result.created.length > 0
        ? `Created ${result.created.length} index(es): ${result.created.map((d) => d.name).join(", ")}`
        : "Nothing to do — all plan indexes already exist",
    );
    return NextResponse.json(result);
  } catch (e: unknown) {
    const causeMessage = (e as { cause?: unknown })?.cause;
    const message =
      causeMessage instanceof Error
        ? `Index creation failed: ${causeMessage.message}`
        : e instanceof Error
          ? e.message
          : "Index creation failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
