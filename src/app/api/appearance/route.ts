// ============================================================================
// Appearance & Branding storage. JSON file in <project>/data (survives
// rebuilds, covered by backups, preserved by update packs).
// GET is open to any signed-in user (it is the app's own look — no secrets);
// PUT requires Manager (users:manage), same as the menu and email config.
// ============================================================================

import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { readAppearance, writeAppearance } from "@/lib/appearance.server";
import { ensureRolesRegistered } from "@/lib/rolesConfig.server";

export const dynamic = "force-dynamic";

export async function GET() {
  const { error: authError } = await authorize();
  if (authError) return authError;
  try {
    ensureRolesRegistered();
    return NextResponse.json({ appearance: readAppearance() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to read appearance" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const { user, error: authError } = await authorize("users:manage");
  if (authError || !user) {
    return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    ensureRolesRegistered();
    const body = await request.json();
    const cfg = writeAppearance(body);
    logAudit(
      user,
      "appearance.save",
      "system",
      `Appearance saved (theme: ${cfg.theme}, factory: ${cfg.factoryName || "—"})`,
    );
    return NextResponse.json({ appearance: cfg });
  } catch (e: any) {
    console.error("PUT appearance error:", e);
    return NextResponse.json({ error: e?.message || "Failed to save appearance" }, { status: 500 });
  }
}
