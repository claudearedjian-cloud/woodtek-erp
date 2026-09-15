// ============================================================================
// Packing QC checklist.
//   GET — {template, templateIsDefault, checks: {orderId: [bool,...]}}
//         (orders:read — the dispatch cards show progress to everyone)
//   PUT — two modes:
//         {orderId, checks:[bool,...]}  tick/untick a checklist
//              → quality:write OR orders:write OR inventory:write
//         {template:[...]}              edit the factory checklist
//              → users:manage (Manager, in Settings)
// Storage: data/packing-qc-template.json + data/packing-qc.json (no migration).
// PUT /api/dispatch enforces the gate when an order leaves Packing.
// ============================================================================

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
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
import { readChecksFile, readTemplateWithDefault } from "@/lib/packingQc.server";

function dataDir(): string {
  return process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
}

function templateLocation(): string {
  return path.join(dataDir(), "packing-qc-template.json");
}

function checksLocation(): string {
  return path.join(dataDir(), "packing-qc.json");
}

/** Saved template; a missing file means "factory default". Empty = disabled. */
function readTemplate(): { template: string[]; isDefault: boolean } {
  return readTemplateWithDefault();
}

function readChecks(): Record<string, boolean[]> {
  return readChecksFile();
}

function writeChecks(checks: Record<string, boolean[]>): void {
  const file = checksLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, orders: checks }, null, 2), "utf8");
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!can(user.role, "orders:read")) {
    return NextResponse.json({ error: "You cannot view the packing checklist." }, { status: 403 });
  }
  const { template, isDefault } = readTemplate();
  return NextResponse.json({ template, templateIsDefault: isDefault, checks: readChecks() });
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
      fs.writeFileSync(file, JSON.stringify({ version: 1, template }, null, 2), "utf8");
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

    // Mode 2: tick/untick an order's checklist (warehouse floor).
    if (!can(user.role, "quality:write") && !can(user.role, "orders:write") && !can(user.role, "inventory:write")) {
      return NextResponse.json({ error: "You cannot tick the packing checklist." }, { status: 403 });
    }
    const orderId = Number(body?.orderId);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return NextResponse.json({ error: "A valid orderId is required." }, { status: 400 });
    }
    const { template } = readTemplate();
    if (!templateGates(template)) {
      return NextResponse.json({ error: "The packing checklist is disabled (empty template)." }, { status: 409 });
    }
    const checks = normalizeChecks(body?.checks, template.length);
    const all = readChecks();
    all[String(orderId)] = checks;
    writeChecks(all);
    logAudit(
      user,
      "packing.qc",
      "order",
      checklistComplete(checks)
        ? `Packing QC checklist completed (${template.length}/${template.length})`
        : `Packing QC checklist updated (${checklistProgress(checks)}/${template.length})`,
      orderId,
    );
    return NextResponse.json({ ok: true, orderId, checks });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to save the packing checklist" }, { status: 500 });
  }
}
