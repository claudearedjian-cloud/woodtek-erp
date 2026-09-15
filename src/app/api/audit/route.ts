// ============================================================================
// GET  /api/audit — the audit trail (users:manage = Manager only).
//      ?q= substring filter across action/detail/actor/entity; newest first.
// DELETE /api/audit — clear the trail (users:manage).
// Storage: data/audit-log.json via src/lib/audit.server.ts.
// ============================================================================

import { NextResponse } from "next/server";
import { authorize, getSessionUser } from "@/lib/auth";
import { clearAudit, logAudit, readAudit } from "@/lib/audit.server";

export async function GET(request: Request) {
  const { error } = await authorize("users:manage");
  if (error) return error;
  try {
    const q = new URL(request.url).searchParams.get("q") ?? "";
    const entries = readAudit({ q, limit: 300 });
    return NextResponse.json({ entries });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to read the audit log" }, { status: 500 });
  }
}

export async function DELETE() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!canManage(user.role)) return NextResponse.json({ error: "Manager only." }, { status: 403 });
  clearAudit();
  logAudit({ id: user.id, name: user.name, role: user.role }, "audit.clear", "system", "Audit log cleared");
  return NextResponse.json({ ok: true });
}

function canManage(role: string): boolean {
  // Mirrors users:manage holders without importing the matrix twice.
  return role === "Manager";
}
