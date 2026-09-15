// ============================================================================
// Order archive — hide finished/cancelled orders from the Orders tab without
// deleting anything.
//   GET — the archived order IDs (orders:read)
//   PUT — {orderId, archived: true|false} archive or restore (orders:write)
// Storage: data/order-archive.json {version:1, archived:[ids]} (no migration).
// Pure helpers in src/lib/orderArchive.ts. Every write is audited.
// ============================================================================

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit.server";
import { sanitizeArchivedIds, withArchived } from "@/lib/orderArchive";

interface ArchiveFile {
  version: 1;
  archived: number[];
}

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "order-archive.json");
}

function readArchive(): number[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    return sanitizeArchivedIds(parsed?.archived);
  } catch {
    return [];
  }
}

function writeArchive(ids: number[]): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, archived: ids }, null, 2), "utf8");
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!can(user.role, "orders:read")) {
    return NextResponse.json({ error: "You cannot view the orders list." }, { status: 403 });
  }
  return NextResponse.json({ archived: readArchive() });
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!can(user.role, "orders:write")) {
    return NextResponse.json({ error: "You cannot archive or restore orders." }, { status: 403 });
  }
  try {
    const body = await request.json();
    const orderId = Number(body?.orderId);
    const archived = body?.archived === true;
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "A valid orderId is required." }, { status: 400 });
    }
    const ids = withArchived(readArchive(), orderId, archived);
    writeArchive(ids);
    logAudit(
      user,
      archived ? "order.archive" : "order.unarchive",
      "order",
      archived ? "Order archived (hidden from the default orders list)" : "Order restored from the archive",
      orderId,
    );
    return NextResponse.json({ ok: true, orderId, archived, archivedIds: ids });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to update the archive" }, { status: 500 });
  }
}
