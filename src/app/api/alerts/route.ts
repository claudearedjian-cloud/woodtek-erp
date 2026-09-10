import { NextResponse } from "next/server";
import { db } from "@/db";
import { assets, inventoryItems } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { listOrdersForUser } from "@/lib/dataAccess";
import { readReceived } from "@/lib/bomStatus.server";

// ============================================================================
// GET /api/alerts — everything that needs a human's attention right now:
//   • orders past their due date that are still open
//   • orders whose operator flagged materials as NOT received
//   • plant assets whose service interval is exhausted
//   • inventory at or below the reorder level
// Every alert carries the tab it should navigate to.
// ============================================================================

const OPEN_STATUSES = new Set(["Pending", "In Production", "Quality Review"]);

export async function GET() {
  const { user, error: authError } = await authorize("orders:read");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const now = Date.now();
    const [orderRows, assetRows, invRows] = await Promise.all([
      listOrdersForUser(user),
      db.select().from(assets),
      db.select().from(inventoryItems),
    ]);

    const alerts: Array<{ kind: string; severity: string; title: string; detail: string; tab: string }> = [];

    for (const o of orderRows as any[]) {
      if (OPEN_STATUSES.has(o.status) && o.dueDate && new Date(o.dueDate).getTime() < now) {
        alerts.push({
          kind: "order",
          severity: "rose",
          title: `${o.orderNumber} is overdue`,
          detail: `${o.title} · was due ${new Date(o.dueDate).toLocaleDateString()}`,
          tab: "orders",
        });
      }
    }

    const received = readReceived();
    for (const [orderId, entry] of Object.entries(received)) {
      if (entry.received === false) {
        const o = (orderRows as any[]).find((x) => String(x.id) === orderId);
        if (o && OPEN_STATUSES.has(o.status)) {
          alerts.push({
            kind: "materials",
            severity: "amber",
            title: `${o.orderNumber}: operator reports materials NOT received`,
            detail: "The station is waiting — chase the warehouse",
            tab: "warehouse",
          });
        }
      }
    }

    for (const a of assetRows) {
      const interval = Math.max(1, a.serviceIntervalHours || 500);
      const since = Math.max(0, (a.runtimeHours || 0) - (a.lastServiceHours || 0));
      if (a.status !== "Under Maintenance" && a.status !== "Decommissioned" && since >= interval) {
        alerts.push({
          kind: "cmms",
          severity: "orange",
          title: `${a.assetTag} service overdue`,
          detail: `${a.name} · ${Math.round(since - interval)}h past its ${interval}h interval`,
          tab: "cmms",
        });
      }
    }

    for (const i of invRows) {
      if (i.stockQuantity <= i.reorderLevel) {
        alerts.push({
          kind: "stock",
          severity: "violet",
          title: `Low stock: ${i.name}`,
          detail: `${i.stockQuantity} ${i.unit} left · reorder level ${i.reorderLevel}`,
          tab: "inventory",
        });
      }
    }

    return NextResponse.json({ alerts, count: alerts.length });
  } catch (error: any) {
    console.error("GET alerts error:", error);
    return NextResponse.json({ error: error?.message || "Failed to load alerts" }, { status: 500 });
  }
}
