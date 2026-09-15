// ============================================================================
// GET /api/digest — the boss's morning brief, one call:
//   • open orders past their due date (with days late)
//   • open orders due within the next 7 days
//   • orders whose operator flagged materials NOT RECEIVED / DECLINED
//   • open orders with warehouse BOM lines not fully sent
//   • machines down right now (open downtime events)
//   • CMMS assets past their service interval
//   • completed orders still awaiting delivery
//   • inventory at/below reorder level
// Requires orders:read (the alerts-style surfaces). List lengths are capped.
// Pure formatting lives in src/lib/digest.ts.
// ============================================================================

import { NextResponse } from "next/server";
import { eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import { assets, downtimeEvents, inventoryItems, machines, orderMaterials } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { listOrdersForUser } from "@/lib/dataAccess";
import { readBomStatus, readReceived } from "@/lib/bomStatus.server";
import type { DigestData } from "@/lib/digest";

const OPEN_STATUSES = new Set(["Pending", "In Production", "Quality Review"]);
const DAY_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  const { user, error: authError } = await authorize("orders:read");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);
    const in7Days = new Date(startOfToday.getTime() + 7 * DAY_MS);

    const [orderRows, assetRows, invRows] = await Promise.all([
      listOrdersForUser(user),
      db.select().from(assets),
      db.select().from(inventoryItems),
    ]);
    const all = orderRows as any[];
    const open = all.filter((o) => OPEN_STATUSES.has(o.status));
    const openIds = open.map((o) => o.id);

    // --- Orders: overdue + due soon -----------------------------------------
    const toRow = (o: any, extra: object = {}) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      title: o.title,
      customerCompany: o.customerCompany,
      dueDate: o.dueDate,
      status: o.status,
      ...extra,
    });
    const overdue = open
      .filter((o) => o.dueDate && new Date(o.dueDate).getTime() < startOfToday.getTime())
      .map((o) =>
        toRow(o, {
          daysLate: Math.max(1, Math.floor((startOfToday.getTime() - new Date(o.dueDate).getTime()) / DAY_MS)),
        }),
      )
      .sort((a: any, b: any) => b.daysLate - a.daysLate)
      .slice(0, 12);
    const dueSoon = open
      .filter((o) => {
        if (!o.dueDate) return false;
        const t = new Date(o.dueDate).getTime();
        return t >= startOfToday.getTime() && t <= in7Days.getTime();
      })
      .sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
      .slice(0, 12)
      .map((o) => toRow(o));

    // --- Materials reception issues (operator flags) -------------------------
    const received = readReceived();
    const materials = Object.entries(received)
      .filter(([, e]) => e.received === false)
      .map(([orderId, e]) => {
        const o = open.find((x) => String(x.id) === orderId);
        return o
          ? {
              orderId: o.id,
              orderNumber: o.orderNumber,
              title: o.title,
              state: e.state ?? "Not Received",
            }
          : null;
      })
      .filter(Boolean)
      .slice(0, 12);

    // --- Warehouse lines not fully sent --------------------------------------
    let warehousePending: DigestData["warehousePending"] = [];
    if (openIds.length > 0) {
      const lineRows = await db
        .select({ id: orderMaterials.id, orderId: orderMaterials.orderId })
        .from(orderMaterials)
        .where(inArray(orderMaterials.orderId, openIds));
      const entries = readBomStatus().entries;
      const pendingByOrder = new Map<number, number>();
      const totalByOrder = new Map<number, number>();
      for (const l of lineRows) {
        totalByOrder.set(l.orderId, (totalByOrder.get(l.orderId) ?? 0) + 1);
        const st = entries[String(l.id)]?.status ?? "Requested";
        if (st !== "Delivered") pendingByOrder.set(l.orderId, (pendingByOrder.get(l.orderId) ?? 0) + 1);
      }
      warehousePending = open
        .filter((o) => (pendingByOrder.get(o.id) ?? 0) > 0)
        .sort((a: any, b: any) => new Date(a.dueDate ?? 0).getTime() - new Date(b.dueDate ?? 0).getTime())
        .slice(0, 10)
        .map((o) => ({
          orderId: o.id,
          orderNumber: o.orderNumber,
          title: o.title,
          pending: pendingByOrder.get(o.id) ?? 0,
          total: totalByOrder.get(o.id) ?? 0,
        }));
    }

    // --- Machines down right now ---------------------------------------------
    const downRows = await db
      .select({
        code: machines.code,
        name: machines.name,
        reason: downtimeEvents.reason,
        startedAt: downtimeEvents.startedAt,
      })
      .from(downtimeEvents)
      .leftJoin(machines, eq(downtimeEvents.machineId, machines.id))
      .where(isNull(downtimeEvents.endedAt));
    const machinesDown = downRows
      .map((r) => ({
        code: r.code,
        name: r.name,
        reason: r.reason,
        minutes: Math.max(0, Math.round((now.getTime() - new Date(r.startedAt).getTime()) / 60000)),
      }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10);

    // --- CMMS service overdue (same rule as the alerts bell) ------------------
    const serviceDue = (assetRows as any[])
      .filter((a) => {
        const interval = Math.max(1, a.serviceIntervalHours || 500);
        const since = Math.max(0, (a.runtimeHours || 0) - (a.lastServiceHours || 0));
        return a.status !== "Under Maintenance" && a.status !== "Decommissioned" && since >= interval;
      })
      .map((a) => {
        const interval = Math.max(1, a.serviceIntervalHours || 500);
        const since = Math.max(0, (a.runtimeHours || 0) - (a.lastServiceHours || 0));
        return {
          assetTag: a.assetTag,
          name: a.name,
          interval,
          pastBy: Math.round(since - interval),
        };
      })
      .sort((a, b) => b.pastBy - a.pastBy)
      .slice(0, 10);

    // --- Completed, awaiting delivery -----------------------------------------
    const awaitingDelivery = all
      .filter((o) => o.status === "Completed")
      .slice(0, 12)
      .map((o) => toRow(o));

    // --- Low stock -------------------------------------------------------------
    const lowStock = (invRows as any[])
      .filter((i) => i.stockQuantity <= i.reorderLevel)
      .map((i) => ({ name: i.name, qty: i.stockQuantity, unit: i.unit, reorderLevel: i.reorderLevel }))
      .slice(0, 10);

    const payload: DigestData = {
      date: now.toISOString(),
      overdue,
      dueSoon,
      materials: materials as DigestData["materials"],
      warehousePending,
      machinesDown,
      serviceDue,
      awaitingDelivery,
      lowStock,
    };
    return NextResponse.json(payload);
  } catch (error: any) {
    console.error("GET digest error:", error);
    return NextResponse.json({ error: error?.message || "Failed to build the digest" }, { status: 500 });
  }
}
