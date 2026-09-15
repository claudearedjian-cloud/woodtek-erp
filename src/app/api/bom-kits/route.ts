// ============================================================================
// BOM kits — reusable materials lists for the New Order wizard.
//   GET    — all kits (orders:read)
//   PUT    — create/replace a kit {name, items:[{itemId, qty}]}
//            (inventory:write OR orders:write — same gate as the BOM board)
//   DELETE — ?name= (same gate)
// Storage: data/bom-kits.json (no migration). Pure helpers in
// src/lib/bomKits.ts. Every write is audited.
// ============================================================================

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { authorize, getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { findKit, sanitizeKitList, sanitizeKitName, type BomKit } from "@/lib/bomKits";
import { logAudit } from "@/lib/audit.server";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "bom-kits.json");
}

function readKits(): BomKit[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    return sanitizeKitList(parsed?.kits);
  } catch {
    return [];
  }
}

function writeKits(kits: BomKit[]): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, kits }, null, 2), "utf8");
}

function canWrite(role: string): boolean {
  return can(role, "inventory:write") || can(role, "orders:write");
}

export async function GET() {
  const { error } = await authorize("orders:read");
  if (error) return error;
  return NextResponse.json({ kits: readKits() });
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!canWrite(user.role)) {
    return NextResponse.json({ error: "You cannot save material kits." }, { status: 403 });
  }
  try {
    const body = await request.json();
    const name = sanitizeKitName(body?.name);
    if (!name) return NextResponse.json({ error: "A kit name is required." }, { status: 400 });

    const kits = readKits();
    const incoming = sanitizeKitList([{ name, items: body?.items, updatedAt: new Date().toISOString() }]);
    if (incoming.length === 0) {
      return NextResponse.json({ error: "The kit needs at least one valid material line." }, { status: 400 });
    }
    const kit = incoming[0];
    const existing = findKit(kits, name);
    if (existing) {
      Object.assign(existing, kit);
    } else {
      kits.push(kit);
    }
    writeKits(kits);
    logAudit(user, "bom.kit.save", "system", `Kit "${kit.name}" saved (${kit.items.length} item(s))`);
    return NextResponse.json({ ok: true, kits });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to save the kit" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!canWrite(user.role)) {
    return NextResponse.json({ error: "You cannot delete material kits." }, { status: 403 });
  }
  const name = sanitizeKitName(new URL(request.url).searchParams.get("name"));
  if (!name) return NextResponse.json({ error: "A kit name is required." }, { status: 400 });
  const kits = readKits();
  const kit = findKit(kits, name);
  if (!kit) return NextResponse.json({ error: "Kit not found." }, { status: 404 });
  writeKits(kits.filter((k) => k !== kit));
  logAudit(user, "bom.kit.delete", "system", `Kit "${kit.name}" deleted`);
  return NextResponse.json({ ok: true, kits: kits.filter((k) => k !== kit) });
}
