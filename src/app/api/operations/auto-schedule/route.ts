import { NextResponse } from "next/server";
import { db } from "@/db";
import { orderOperations, orders, machines } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";

// ============================================================================
// POST /api/operations/auto-schedule
// Assigns dispatch slots to every open operation that has none, automatically:
//   • Workflow  — operations are placed in routing order (stepOrder); an
//     operation never starts before the previous step of its order ends.
//   • Priority  — Urgent orders first, then High, then by due date.
//   • Availability — a machine is never double-booked (existing bookings are
//     respected) and Maintenance/Offline machines are never used. When an
//     operation has no machine assigned, the machine that can start it
//     earliest wins.
// ============================================================================

const PLAN_STATUSES = new Set(["Pending", "Ready"]);
const PRIORITY_RANK: Record<string, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

export async function POST() {
  const { user, error: authError } = await authorize("operations:update-status");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [allOps, orderRows, machineRows] = await Promise.all([
      db.select().from(orderOperations),
      db.select({ id: orders.id, priority: orders.priority, dueDate: orders.dueDate }).from(orders),
      db.select().from(machines),
    ]);

    const now = Date.now();
    const machineById = new Map(machineRows.map((m) => [m.id, m]));
    const orderInfo = new Map(orderRows.map((o) => [o.id, o]));

    // Busy windows per machine (every existing booking).
    const busy = new Map<number, Array<[number, number]>>();
    for (const op of allOps) {
      if (op.machineId && op.scheduledStart && op.scheduledEnd) {
        const list = busy.get(op.machineId) ?? [];
        list.push([new Date(op.scheduledStart).getTime(), new Date(op.scheduledEnd).getTime()]);
        busy.set(op.machineId, list);
      }
    }

    // Order timeline: nothing may start before the order's latest finished/booked step.
    const orderEnd = new Map<number, number>();
    for (const op of allOps) {
      const t = op.scheduledEnd
        ? new Date(op.scheduledEnd).getTime()
        : op.endTime
          ? new Date(op.endTime).getTime()
          : 0;
      if (t > 0) orderEnd.set(op.orderId, Math.max(orderEnd.get(op.orderId) ?? 0, t));
    }

    const pending = allOps.filter((op) => PLAN_STATUSES.has(op.status) && !op.scheduledStart);
    pending.sort((a, b) => {
      const oa = orderInfo.get(a.orderId);
      const ob = orderInfo.get(b.orderId);
      const ra = PRIORITY_RANK[oa?.priority ?? "Normal"] ?? 2;
      const rb = PRIORITY_RANK[ob?.priority ?? "Normal"] ?? 2;
      if (ra !== rb) return ra - rb;
      const da = oa?.dueDate ? new Date(oa.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const dbb = ob?.dueDate ? new Date(ob.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      if (da !== dbb) return da - dbb;
      if (a.orderId !== b.orderId) return a.orderId - b.orderId;
      return a.stepOrder - b.stepOrder; // keep routing order inside an order
    });

    // Earliest conflict-free start on a machine, never before `earliest`/now.
    const placeOn = (machineId: number, earliest: number, durationMs: number): number => {
      const intervals = (busy.get(machineId) ?? []).slice().sort((x, y) => x[0] - y[0]);
      let start = Math.max(earliest, now);
      let moved = true;
      while (moved) {
        moved = false;
        for (const [s, e] of intervals) {
          if (start < e && start + durationMs > s) {
            start = e;
            moved = true;
          }
        }
      }
      return start;
    };

    let planned = 0;
    const skipped: string[] = [];

    for (const op of pending) {
      const durationMs = Math.max(1, op.estimatedMinutes || 60) * 60 * 1000;
      const earliest = Math.max(orderEnd.get(op.orderId) ?? 0, now);

      const candidates = (op.machineId ? [op.machineId] : machineRows.map((m) => m.id)).filter((id) => {
        const m = machineById.get(id);
        return m && m.status !== "Maintenance" && m.status !== "Offline";
      });
      if (candidates.length === 0) {
        skipped.push(`${op.operationName} (machine unavailable)`);
        continue;
      }

      let bestId = candidates[0];
      let bestStart = Number.MAX_SAFE_INTEGER;
      for (const id of candidates) {
        const st = placeOn(id, earliest, durationMs);
        if (st < bestStart) {
          bestStart = st;
          bestId = id;
        }
      }
      const endMs = bestStart + durationMs;

      await db
        .update(orderOperations)
        .set({ machineId: bestId, scheduledStart: new Date(bestStart), scheduledEnd: new Date(endMs), updatedAt: new Date() })
        .where(eq(orderOperations.id, op.id));

      busy.set(bestId, [...(busy.get(bestId) ?? []), [bestStart, endMs]]);
      orderEnd.set(op.orderId, Math.max(orderEnd.get(op.orderId) ?? 0, endMs));
      planned += 1;
    }

    return NextResponse.json({ planned, skipped: skipped.length, skippedDetails: skipped.slice(0, 8) });
  } catch (error: any) {
    console.error("POST auto-schedule error:", error);
    return NextResponse.json({ error: error?.message || "Failed to auto-schedule operations" }, { status: 500 });
  }
}
