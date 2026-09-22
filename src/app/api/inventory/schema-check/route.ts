// ============================================================================
// Schema check & repair for the Wood & Edge Stock tables (Manager only).
// GET  → compare live tables with the columns the app expects.
// POST → add missing columns (ADD COLUMN IF NOT EXISTS; never drops anything).
// ============================================================================

import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { checkInventorySchema, repairInventorySchema } from "@/lib/inventorySchemaCheck.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authorize("users:manage");
  if (error) return error;
  try {
    const tables = await checkInventorySchema();
    return NextResponse.json({ tables });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Schema check failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST() {
  const { error } = await authorize("users:manage");
  if (error) return error;
  try {
    const result = await repairInventorySchema();
    return NextResponse.json(result);
  } catch (e: unknown) {
    const causeMessage = (e as { cause?: unknown })?.cause;
    const message =
      causeMessage instanceof Error
        ? `Schema repair failed: ${causeMessage.message}`
        : e instanceof Error
          ? e.message
          : "Schema repair failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
