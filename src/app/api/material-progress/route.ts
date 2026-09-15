// ============================================================================
// Material production stage — per BOM material line of an order.
//   GET ?orderId=N  → { progress: { "<materialId>": {stage, at, by} } }
//                     (orders:read; only that order's lines)
//   PUT {orderMaterialsId, stage} → set "" (not started), a step name, or
//                     "DONE" — floor roles: operations:update-status OR
//                     quality:write OR orders:write OR inventory:write
// Storage: data/material-progress.json {version:1, progress:{...}} (no
// migration). Pure helpers in src/lib/materialProgress.ts. Audited.
// ============================================================================

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orderMaterials } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit.server";
import { sanitizeProgressMap, sanitizeStage } from "@/lib/materialProgress";

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "material-progress.json");
}

function readAll(): Record<string, { stage: string; at: string; by: string }> {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    return sanitizeProgressMap(parsed?.progress);
  } catch {
    return {};
  }
}

function writeAll(progress: Record<string, { stage: string; at: string; by: string }>): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, progress }, null, 2), "utf8");
}

function canSetStage(role: string): boolean {
  return (
    can(role, "operations:update-status") ||
    can(role, "quality:write") ||
    can(role, "orders:write") ||
    can(role, "inventory:write")
  );
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!can(user.role, "orders:read")) {
    return NextResponse.json({ error: "You cannot view material stages." }, { status: 403 });
  }
  const orderId = Number(new URL(request.url).searchParams.get("orderId"));
  if (!Number.isInteger(orderId) || orderId <= 0) {
    return NextResponse.json({ error: "A valid orderId is required." }, { status: 400 });
  }
  try {
    const lines = await db
      .select({ id: orderMaterials.id })
      .from(orderMaterials)
      .where(eq(orderMaterials.orderId, orderId));
    const all = readAll();
    const progress: Record<string, { stage: string; at: string; by: string }> = {};
    for (const line of lines) {
      const hit = all[String(line.id)];
      if (hit) progress[String(line.id)] = hit;
    }
    return NextResponse.json({ progress });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to load material stages" }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!canSetStage(user.role)) {
    return NextResponse.json({ error: "You cannot update material stages." }, { status: 403 });
  }
  try {
    const body = await request.json();
    const materialId = Number(body?.orderMaterialsId);
    const stage = sanitizeStage(body?.stage);
    if (!Number.isInteger(materialId) || materialId <= 0) {
      return NextResponse.json({ error: "A valid orderMaterialsId is required." }, { status: 400 });
    }
    const [line] = await db
      .select({ id: orderMaterials.id, orderId: orderMaterials.orderId })
      .from(orderMaterials)
      .where(eq(orderMaterials.id, materialId));
    if (!line) {
      return NextResponse.json({ error: "This material line no longer exists." }, { status: 404 });
    }
    const all = readAll();
    const entry = { stage, at: new Date().toISOString(), by: user.name || user.role };
    all[String(materialId)] = entry;
    writeAll(all);
    logAudit(
      user,
      "material.stage",
      "order",
      stage === "" ? "Material stage cleared (not started)" : `Material stage: ${stage}`,
      line.orderId,
    );
    return NextResponse.json({ ok: true, entry });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to set the material stage" }, { status: 500 });
  }
}
