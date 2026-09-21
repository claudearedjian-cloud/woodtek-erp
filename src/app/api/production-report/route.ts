// ============================================================================
// Production & utilization report (Manager tab) — one scoped read.
//
// Scope is enforced through the same deny-by-default subqueries as every
// other order screen: orders via listOrdersForUser and operations via
// listOperationsForUser. This route never queries the orders or operations
// tables directly and never broadens a role's data access. The machines
// table is reference data read the same way as /api/bom.
//
// All aggregation logic lives in the pure, unit-tested module
// src/lib/productionReport.ts.
// ============================================================================

import { NextResponse } from "next/server";
import { db } from "@/db";
import { machines } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { listOrdersForUser, listOperationsForUser } from "@/lib/dataAccess";
import {
  buildProductionReport,
  type ProductionRange,
} from "@/lib/productionReport";

const RANGES: ProductionRange[] = ["today", "yesterday", "week", "days7", "month"];

export async function GET(request: Request) {
  const { user, error: authError } = await authorize("orders:read");
  if (authError || !user) {
    return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const raw = (url.searchParams.get("range") || "today").toLowerCase();
  const range: ProductionRange = (RANGES as string[]).includes(raw)
    ? (raw as ProductionRange)
    : "today";

  try {
    const now = new Date();
    const orders = await listOrdersForUser(user);
    const orderIds = new Set(
      orders.filter((order) => order.status !== "Cancelled").map((order) => order.id),
    );
    const ops = (await listOperationsForUser(user)).filter((op) => orderIds.has(op.orderId));
    const machineRows = await db.select().from(machines);

    const report = buildProductionReport({
      now,
      range,
      machines: machineRows.map((m) => ({
        id: m.id,
        code: m.code,
        name: m.name,
        category: m.category,
        status: m.status,
      })),
      ops: ops.map((op) => ({
        id: op.id,
        orderId: op.orderId,
        operationName: op.operationName,
        status: op.status,
        estimatedMinutes: op.estimatedMinutes,
        actualMinutes: op.actualMinutes,
        machineId: op.machineId,
        machineCode: op.machineCode,
        machineCategory: op.machineCategory,
        operatorId: op.operatorId,
        operatorName: op.operatorName,
        startTime: op.startTime ? new Date(op.startTime) : null,
        endTime: op.endTime ? new Date(op.endTime) : null,
        scheduledStart: op.scheduledStart ? new Date(op.scheduledStart) : null,
        scheduledEnd: op.scheduledEnd ? new Date(op.scheduledEnd) : null,
      })),
    });

    return NextResponse.json(report);
  } catch (error) {
    console.error("[production-report] failed:", error);
    return NextResponse.json(
      { error: "Failed to build the production report." },
      { status: 500 },
    );
  }
}
