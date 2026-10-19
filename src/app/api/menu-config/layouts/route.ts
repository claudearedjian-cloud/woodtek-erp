// ============================================================================
// Named Menu Designer layouts. Stored as JSON in <project>/data beside
// menu-config.json, so factory backups cover them and update packs never
// overwrite them. Every operation requires users:manage; loading a layout in
// the designer only changes a draft until the normal menu Save is pressed.
// ============================================================================

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { writeJsonAtomic } from "@/lib/atomicFile.server";
import { logAudit } from "@/lib/audit.server";
import { authorize } from "@/lib/auth";
import {
  deleteMenuLayout,
  sanitizeMenuLayoutLibrary,
  upsertMenuLayout,
  type MenuLayoutLibrary,
} from "@/lib/menuConfig";
import { ensureRolesRegistered } from "@/lib/rolesConfig.server";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "menu-layouts.json");
}

function readLibrary(): MenuLayoutLibrary {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    return sanitizeMenuLayoutLibrary(parsed);
  } catch {
    return { version: 1, layouts: [] };
  }
}

export async function GET() {
  const { error } = await authorize("users:manage");
  if (error) return error;
  ensureRolesRegistered();
  return NextResponse.json({ library: readLibrary() });
}

export async function POST(request: Request) {
  const { error } = await authorize("users:manage");
  if (error) return error;
  try {
    ensureRolesRegistered();
    const body = (await request.json()) as { name?: unknown; config?: unknown };
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "A layout name is required." }, { status: 400 });
    }
    if (!body.config || typeof body.config !== "object" || !Array.isArray((body.config as { items?: unknown }).items)) {
      return NextResponse.json({ error: "A valid menu layout is required." }, { status: 400 });
    }
    const library = upsertMenuLayout(
      readLibrary(),
      name,
      body.config as Parameters<typeof upsertMenuLayout>[2],
    );
    const layout = library.layouts.find(
      (entry) => entry.name.toLowerCase() === name.toLowerCase(),
    );
    if (!layout) {
      return NextResponse.json(
        { error: "The named-layout library is full. Delete an old layout first." },
        { status: 400 },
      );
    }
    writeJsonAtomic(fileLocation(), library);
    logAudit(null, "menu.layout.save", "system", `Saved menu layout "${layout.name}"`);
    return NextResponse.json({ layout, library });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to save the named menu layout" },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  const { error } = await authorize("users:manage");
  if (error) return error;
  try {
    ensureRolesRegistered();
    const name = new URL(request.url).searchParams.get("name")?.trim() ?? "";
    if (!name) {
      return NextResponse.json({ error: "A layout name is required." }, { status: 400 });
    }
    const before = readLibrary();
    const library = deleteMenuLayout(before, name);
    if (library.layouts.length === before.layouts.length) {
      return NextResponse.json({ error: "Named menu layout not found." }, { status: 404 });
    }
    writeJsonAtomic(fileLocation(), library);
    logAudit(null, "menu.layout.delete", "system", `Deleted menu layout "${name}"`);
    return NextResponse.json({ ok: true, library });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to delete the named menu layout" },
      { status: 500 },
    );
  }
}
