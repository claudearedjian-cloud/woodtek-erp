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
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { orderMaterials, orderOperations } from "@/db/schema";
import { nextInRoute, routeLadder } from "@/lib/materialRoutes";
import { readAllRoutes } from "@/lib/materialRoutes.server";
import { findProductionItemByMaterial } from "@/lib/productionPlan";
import { readOrderProductionPlan } from "@/lib/productionPlan.server";
import { getSessionUser } from "@/lib/auth";
import { baseRoleOf, can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit.server";
import { STAGE_DONE, allowedStages, sanitizeStage, stageLadder } from "@/lib/materialProgress";
import { readAllProgress, writeAllProgress } from "@/lib/materialProgress.server";

function canSetStage(role: string): boolean {
  const base = baseRoleOf(role);
  return (
    can(base, "operations:update-status") ||
    can(base, "quality:write") ||
    can(base, "orders:write") ||
    can(base, "inventory:write")
  );
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!can(baseRoleOf(user.role), "orders:read")) {
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
    const all = readAllProgress();
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
    const ops = await db
      .select({ name: orderOperations.operationName, stepOrder: orderOperations.stepOrder })
      .from(orderOperations)
      .where(eq(orderOperations.orderId, line.orderId));
    const orderSteps = ops.sort((a, b) => a.stepOrder - b.stepOrder).map((operation) => operation.name);
    const productionItem = findProductionItemByMaterial(readOrderProductionPlan(line.orderId), materialId);
    if (productionItem) {
      return NextResponse.json(
        { error: "This material stage is controlled by its independent station jobs." },
        { status: 409 },
      );
    }
    const legacyOwnRoute = readAllRoutes()[String(materialId)];
    const steps = legacyOwnRoute ?? orderSteps;
    const all = readAllProgress();
    const current = all[String(materialId)]?.stage ?? "";

    let stage: string;
    if (body?.advance === true) {
      // One tap always follows THIS material's private ladder. This fixes the
      // legacy endpoint that imported routes but still advanced on the order route.
      const ladder = legacyOwnRoute ? routeLadder(steps) : stageLadder(steps);
      const idx = ladder.indexOf(sanitizeStage(current));
      if (idx === -1 || idx >= ladder.length - 1) {
        return NextResponse.json({ error: "This material is already at the last stage." }, { status: 409 });
      }
      stage = ladder[idx + 1];
    } else {
      stage = sanitizeStage(body?.stage);
    }

    // No skipping: validate against the same private route used above.
    const allowed = allowedStages(steps, current);
    if (!allowed.includes(stage)) {
      const label = (s: string) => (s === STAGE_DONE ? "Done" : s === "" ? "Not started" : `"${s}"`);
      const options = allowed.filter((s) => s !== current).map(label).join(" or ");
      return NextResponse.json(
        { error: `Materials move one stage at a time. From ${label(current)} you may go to: ${options}.` },
        { status: 409 },
      );
    }
    const entry = { stage, at: new Date().toISOString(), by: user.name || user.role };
    all[String(materialId)] = entry;
    writeAllProgress(all);
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
