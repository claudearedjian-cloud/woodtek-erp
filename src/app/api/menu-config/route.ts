// ============================================================================
// Menu Designer storage. JSON file in <project>/data (survives rebuilds,
// covered by backups). GET is open to any client (UI metadata only);
// PUT/DELETE require Manager (users:manage).
// ============================================================================

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { authorize } from "@/lib/auth";
import { sanitizeMenuConfig, type MenuConfig } from "@/lib/menuConfig";

function fileLocation(): string {
  const dir =
    process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "menu-config.json");
}

function readConfig(): MenuConfig | null {
  try {
    const raw = fs.readFileSync(fileLocation(), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.items)) return parsed as MenuConfig;
    return null;
  } catch {
    return null;
  }
}

export async function GET() {
  return NextResponse.json({ config: readConfig() });
}

export async function PUT(request: Request) {
  const { error } = await authorize("users:manage");
  if (error) return error;
  try {
    const body = await request.json();
    const config = sanitizeMenuConfig(body);
    const file = fileLocation();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(config, null, 2), "utf8");
    return NextResponse.json({ config });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to save menu configuration" },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const { error } = await authorize("users:manage");
  if (error) return error;
  try {
    fs.rmSync(fileLocation(), { force: true });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to reset menu configuration" },
      { status: 500 },
    );
  }
}
