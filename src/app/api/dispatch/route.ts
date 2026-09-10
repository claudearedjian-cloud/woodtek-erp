// ============================================================================
// Dispatch queue: completed orders awaiting the delivery pipeline.
//   GET  — every Completed order with its current stage (overlay file, or the
//          category-derived default when untouched).
//   PUT  — move an order to a stage (cleaning/qc/packing/awaiting_delivery/
//          delivered). Requires quality:write OR orders:write OR inventory:write.
// Stage storage: data/dispatch-status.json (no DB migration).
// ============================================================================

import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  ALL_STAGES,
  defaultStage,
  type DispatchStage,
} from "@/lib/dispatch";

interface DispatchFile {
  version: 1;
  stages: Record<string, { stage: DispatchStage; updatedAt?: string; proof?: { receivedBy: string; deliveredAt: string; notes: string | null } | null }>;
}

function fileLocation(): string {
  const dir = process.env.WOODTEK_DATA_DIR || path.join(process.cwd(), "data");
  return path.join(dir, "dispatch-status.json");
}

function readFile(): DispatchFile {
  try {
    const parsed = JSON.parse(fs.readFileSync(fileLocation(), "utf8"));
    if (parsed && typeof parsed.stages === "object" && parsed.stages) {
      return { version: 1, stages: parsed.stages };
    }
  } catch {
    /* missing or corrupt */
  }
  return { version: 1, stages: {} };
}

function writeFile(data: DispatchFile): void {
  const file = fileLocation();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (!can(user.role, "orders:read")) {
    return NextResponse.json({ error: "You cannot view dispatch." }, { status: 403 });
  }
  try {
    const completed = await db
      .select({
        id: orders.id,
        orderNumber: orders.orderNumber,
        title: orders.title,
        projectType: orders.projectType,
        status: orders.status,
        dueDate: orders.dueDate,
        customerCompany: customers.company,
      })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(inArray(orders.status, ["Completed", "Delivered"]))
      .orderBy(asc(orders.dueDate));

    const stages = readFile().stages;
    const payload = completed.map((o) => ({
      ...o,
      stage: (stages[String(o.id)]?.stage as DispatchStage) ?? defaultStage(o.projectType),
      proof: stages[String(o.id)]?.proof ?? null,
    }));
    return NextResponse.json({ orders: payload });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load the dispatch queue";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "You are signed out." }, { status: 401 });
  if (
    !can(user.role, "quality:write") &&
    !can(user.role, "orders:write") &&
    !can(user.role, "inventory:write")
  ) {
    return NextResponse.json({ error: "You cannot update dispatch stages." }, { status: 403 });
  }
  try {
    const body = await request.json();
    const orderId = Number(body.orderId);
    const stage = String(body.stage) as DispatchStage;
    if (!Number.isInteger(orderId) || orderId <= 0 || !ALL_STAGES.includes(stage)) {
      return NextResponse.json({ error: "A valid orderId and stage are required." }, { status: 400 });
    }
    const data = readFile();
    const entry: any = { stage, updatedAt: new Date().toISOString() };
    if (body.proof && typeof body.proof === "object") {
      entry.proof = {
        receivedBy: String(body.proof.receivedBy ?? "").slice(0, 120) || "—",
        deliveredAt: new Date().toISOString(),
        notes: String(body.proof.notes ?? "").slice(0, 500) || null,
      };
    }
    data.stages[String(orderId)] = entry;
    writeFile(data);
    if (stage === "delivered") {
      // Delivery confirmed at the gate: the order leaves open work everywhere.
      await db.update(orders).set({ status: "Delivered" }).where(eq(orders.id, orderId));
    }
    return NextResponse.json({ ok: true, orderId, stage });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update dispatch stage";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
