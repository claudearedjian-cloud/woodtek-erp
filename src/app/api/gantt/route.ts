// ============================================================================
// Gantt / order timeline data — one scoped read that powers both the daily
// timeline (issue date → due date candles with true-dated step bars) and the
// Deadline Health board.
//
// Scope is enforced through the same deny-by-default subqueries as every
// other order screen: orders via listOrdersForUser and operations via
// listOperationsForUser. This route never queries the orders or operations
// tables directly and never broadens a role's data access. Financial fields
// are redacted exactly like /api/orders.
//
// Delivery state comes from the no-migration dispatch overlay
// (data/dispatch-status.json); this route is read-only against it.
// ============================================================================

import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { listOrdersForUser, listOperationsForUser } from "@/lib/dataAccess";
import { readProductionPlanStore } from "@/lib/productionPlan.server";
import { readDispatchStore, type DispatchStore } from "@/lib/dispatch.server";
import { ALL_STAGES, type DispatchStage } from "@/lib/dispatch";

const DAY_MS = 86_400_000;
const RECENT_DELIVERY_DAYS = 14;

interface DispatchSummary {
  stage: string | null;
  mixed: boolean;
  deliveredCount: number;
  totalBatches: number;
  deliveredAt: string | null;
}

/** Combine an order's batch rows and any legacy order-level dispatch row. */
function dispatchSummaryFor(orderId: number, store: DispatchStore): DispatchSummary {
  const batches = Object.values(store.batches).filter((entry) => entry.orderId === orderId);
  const legacy = store.stages[String(orderId)];
  const entries = legacy ? [...batches, legacy] : batches;
  if (entries.length === 0) {
    return { stage: null, mixed: false, deliveredCount: 0, totalBatches: 0, deliveredAt: null };
  }
  const stages = entries.map((entry) => entry.stage as DispatchStage);
  const deliveredCount = stages.filter((stage) => stage === "delivered").length;
  const deliveredAt =
    entries
      .map((entry) => entry.proof?.deliveredAt ?? null)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null;
  const allDelivered = deliveredCount === entries.length;
  const indexes = stages.map((stage) => ALL_STAGES.indexOf(stage)).filter((i) => i >= 0);
  const stage: string | null = allDelivered
    ? "delivered"
    : indexes.length > 0
      ? ALL_STAGES[Math.min(...indexes)]
      : null;
  return {
    stage,
    mixed: new Set(stages).size > 1,
    deliveredCount,
    totalBatches: entries.length,
    deliveredAt,
  };
}

export async function GET() {
  const { user, error: authError } = await authorize("orders:read");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const store = readDispatchStore();
    const allOrders = await listOrdersForUser(user);
    const now = Date.now();

    // Active orders always; delivered orders only while "recent" so the
    // Recently Delivered column stays meaningful instead of stretching the
    // auto-fit window across months of history.
    const included = allOrders.filter((order) => {
      if (order.status === "Cancelled") return false;
      if (order.status === "Delivered") {
        const summary = dispatchSummaryFor(order.id, store);
        if (!summary.deliveredAt) return false;
        return now - new Date(summary.deliveredAt).getTime() <= (RECENT_DELIVERY_DAYS + 1) * DAY_MS;
      }
      return true;
    });
    const includedIds = new Set(included.map((order) => order.id));

    const operations = (await listOperationsForUser(user)).filter((op) =>
      includedIds.has(op.orderId),
    );

    // Material-batch binding (order number → batch name/number) mirrors the
    // operations endpoint so parallel cut lists can get their own lanes.
    const planStore = readProductionPlanStore();
    const bindings = new Map<number, { materialId: number; name: string; batchNumber: number }>();
    for (const plan of Object.values(planStore.orders)) {
      if (!includedIds.has(plan.orderId)) continue;
      plan.items.forEach((item, index) => {
        for (const step of item.steps) {
          bindings.set(step.operationId, {
            materialId: item.materialId,
            name: item.name,
            batchNumber: index + 1,
          });
        }
      });
    }

    const opsByOrder = new Map<number, typeof operations>();
    for (const op of operations) {
      const list = opsByOrder.get(op.orderId) ?? [];
      list.push(op);
      opsByOrder.set(op.orderId, list);
    }

    const payload = included
      .map((order) => {
        const ops = (opsByOrder.get(order.id) ?? [])
          .slice()
          .sort((a, b) => a.stepOrder - b.stepOrder || a.id - b.id);
        return {
          id: order.id,
          orderNumber: order.orderNumber,
          title: order.title,
          customerLabel: order.customerCompany || order.customerName || "",
          projectType: order.projectType,
          priority: order.priority,
          status: order.status,
          createdAt: order.createdAt,
          dueDate: order.dueDate,
          progressPercent: order.progressPercent ?? 0,
          totalValue: order.totalValue ?? null,
          totalSteps: ops.length,
          completedSteps: ops.filter((op) => op.status === "Completed").length,
          dispatch: dispatchSummaryFor(order.id, store),
          steps: ops.map((op) => {
            const binding = bindings.get(op.id);
            return {
              id: op.id,
              stepOrder: op.stepOrder,
              operationName: op.operationName,
              status: op.status,
              machineCode: op.machineCode,
              machineCategory: op.machineCategory,
              estimatedMinutes: op.estimatedMinutes,
              scheduledStart: op.scheduledStart,
              scheduledEnd: op.scheduledEnd,
              startTime: op.startTime,
              endTime: op.endTime,
              batchId: binding ? binding.materialId : null,
              batchName: binding ? binding.name : null,
              batchNumber: binding ? binding.batchNumber : null,
            };
          }),
        };
      })
      .sort(
        (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime() || a.id - b.id,
      );

    return NextResponse.json(
      { generatedAt: new Date(now).toISOString(), orders: payload },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error: any) {
    console.error("GET gantt error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to load the order timeline" },
      { status: 500 },
    );
  }
}
