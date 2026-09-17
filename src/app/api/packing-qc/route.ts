// ============================================================================
// Packing QC checklist.
//   GET — template + legacy order checks + independent material-batch checks
//   PUT — {orderId, batchId?, checks} or Manager-only {template}
// Storage: packing-qc-template.json + packing-qc.json (no migration).
// ============================================================================

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { orderMaterials } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { logAudit } from "@/lib/audit.server";
import {
  checklistComplete,
  checklistProgress,
  normalizeChecks,
  sanitizeTemplate,
  templateGates,
} from "@/lib/packingQc";
import {
  readPackingChecksStore,
  readTemplateWithDefault,
  writePackingChecksStore,
} from "@/lib/packingQc.server";

function dataDir(): string {
  return process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
}

function templateLocation(): string {
  return path.join(dataDir(), "packing-qc-template.json");
}

function canWriteChecks(role: string): boolean {
  return can(role, "quality:write") || can(role, "orders:write") || can(role, "inventory:write");
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!can(user.role, "orders:read")) {
    return NextResponse.json({ error: "You cannot view the packing checklist." }, { status: 403 });
  }
  const { template, isDefault } = readTemplateWithDefault();
  const store = readPackingChecksStore();
  return NextResponse.json({
    template,
    templateIsDefault: isDefault,
    checks: store.orders,
    batchChecks: store.batches,
  });
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  try {
    const body = await request.json();

    // Mode 1: edit the factory checklist (Manager only, from Settings).
    if (Array.isArray(body?.template)) {
      if (!can(user.role, "users:manage")) {
        return NextResponse.json({ error: "Only the Manager can edit the packing checklist template." }, { status: 403 });
      }
      const template = sanitizeTemplate(body.template);
      if (template.length > 0 && !templateGates(template)) {
        return NextResponse.json({ error: "The checklist needs at least one item." }, { status: 400 });
      }
      const file = templateLocation();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temp, JSON.stringify({ version: 1, template }, null, 2), "utf8");
      fs.renameSync(temp, file);
      logAudit(
        user,
        "packing.qc.template",
        "system",
        template.length === 0
          ? "Packing QC checklist DISABLED (empty template)"
          : `Packing QC checklist set (${template.length} item(s))`,
      );
      return NextResponse.json({ ok: true, template });
    }

    if (!canWriteChecks(user.role)) {
      return NextResponse.json({ error: "You cannot tick the packing checklist." }, { status: 403 });
    }
    const orderId = Number(body?.orderId);
    const batchId = body?.batchId == null ? null : Number(body.batchId);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "A valid orderId is required." }, { status: 400 });
    }
    if (batchId !== null && (!Number.isInteger(batchId) || batchId <= 0)) {
      return NextResponse.json({ error: "A valid material batch id is required." }, { status: 400 });
    }
    if (batchId !== null) {
      const [material] = await db
        .select({ id: orderMaterials.id })
        .from(orderMaterials)
        .where(and(eq(orderMaterials.id, batchId), eq(orderMaterials.orderId, orderId)));
      if (!material) return NextResponse.json({ error: "Material batch not found on this order." }, { status: 404 });
    }

    const { template } = readTemplateWithDefault();
    if (!templateGates(template)) {
      return NextResponse.json({ error: "The packing checklist is disabled (empty template)." }, { status: 409 });
    }
    const checks = normalizeChecks(body?.checks, template.length);
    const store = readPackingChecksStore();
    if (batchId !== null) store.batches[String(batchId)] = checks;
    else store.orders[String(orderId)] = checks;
    writePackingChecksStore(store);

    logAudit(
      user,
      "packing.qc",
      batchId !== null ? "order_material" : "order",
      `${batchId !== null ? `Batch ${batchId}` : `Order ${orderId}`} checklist `
        + (checklistComplete(checks)
          ? `completed (${template.length}/${template.length})`
          : `updated (${checklistProgress(checks)}/${template.length})`),
      batchId ?? orderId,
    );
    return NextResponse.json({ ok: true, orderId, batchId, checks });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Failed to save the packing checklist" }, { status: 500 });
  }
}
