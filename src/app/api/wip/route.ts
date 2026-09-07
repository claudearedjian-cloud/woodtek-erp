import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import {
  listOrdersForUser,
  listMachinesForUser,
  listOperationsForUser,
  listQualityEventsForUser,
  listDowntimeEventsForUser,
} from "@/lib/dataAccess";

/**
 * Aggregates the live shop-floor picture for the WIP board:
 *   - every machine with its current job, queue and open downtime
 *   - every active order with its step progress and defect counts
 *   - board-level KPIs (running stations, machines down, open rework, scrap today)
 */
export async function GET() {
  const { user, error: authError } = await authorize("wip:read");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [machines, operations, orders, quality, downtime] = await Promise.all([
      listMachinesForUser(user),
      listOperationsForUser(user),
      listOrdersForUser(user),
      listQualityEventsForUser(user),
      listDowntimeEventsForUser(user),
    ]);

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const activeDowntime = downtime.filter(d => !d.endedAt);
    const openRework = quality.filter(
      q => q.eventType === "rework" && (q.disposition === "Open" || q.disposition === "In Rework"),
    );
    const scrapToday = quality.filter(
      q => q.eventType === "scrap" && new Date(q.createdAt) >= startOfDay,
    );
    const reworkToday = quality.filter(
      q => q.eventType === "rework" && new Date(q.createdAt) >= startOfDay,
    );

    // --- Machines with live state ----------------------------------------
    const machineBoard = machines.map(m => {
      const machineOps = operations
        .filter(o => o.machineId === m.id)
        .sort((a, b) => a.stepOrder - b.stepOrder);
      const currentJob = machineOps.find(o => o.status === "In Progress") || null;
      const queue = machineOps.filter(o => o.status === "Ready" || o.status === "Pending");
      const openDown = activeDowntime.find(d => d.machineId === m.id) || null;

      let state: string;
      if (openDown) state = "Down";
      else if (m.status === "Maintenance" || m.status === "Offline") state = m.status;
      else if (currentJob) state = "Running";
      else state = "Idle";

      return {
        id: m.id,
        name: m.name,
        code: m.code,
        category: m.category,
        location: m.location,
        state,
        currentJob,
        queue,
        queueMinutes: queue.reduce((s, o) => s + (o.estimatedMinutes || 0), 0),
        openDowntime: openDown,
      };
    });

    // --- Orders with WIP detail ------------------------------------------
    const activeStatuses = new Set(["In Production", "Pending", "Quality Review", "On Hold"]);
    const orderBoard = orders
      .filter(o => activeStatuses.has(o.status))
      .map(o => {
        const orderOps = operations
          .filter(op => op.orderId === o.id)
          .sort((a, b) => a.stepOrder - b.stepOrder);
        const runningOps = orderOps.filter(op => op.status === "In Progress");
        const orderQuality = quality.filter(q => q.orderId === o.id);
        return {
          id: o.id,
          orderNumber: o.orderNumber,
          title: o.title,
          customerName: o.customerName,
          priority: o.priority,
          status: o.status,
          dueDate: o.dueDate,
          progressPercent: o.progressPercent,
          totalSteps: orderOps.length,
          completedSteps: orderOps.filter(op => op.status === "Completed").length,
          runningOps,
          rejectedOps: orderOps.filter(op => op.status === "Rejected/Rework"),
          openReworkCount: orderQuality.filter(q => q.eventType === "rework" && (q.disposition === "Open" || q.disposition === "In Rework")).length,
          scrapQty: orderQuality.filter(q => q.eventType === "scrap").reduce((s, q) => s + q.quantity, 0),
        };
      })
      .sort((a, b) => {
        const order = { Urgent: 0, High: 1, Normal: 2 } as Record<string, number>;
        return (order[a.priority] ?? 2) - (order[b.priority] ?? 2);
      });

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      kpis: {
        activeOrders: orderBoard.length,
        runningStations: machineBoard.filter(m => m.state === "Running").length,
        idleStations: machineBoard.filter(m => m.state === "Idle").length,
        machinesDown: machineBoard.filter(m => m.state === "Down").length,
        openRework: openRework.length,
        openReworkQty: openRework.reduce((s, q) => s + q.quantity, 0),
        scrapTodayQty: scrapToday.reduce((s, q) => s + q.quantity, 0),
        reworkTodayQty: reworkToday.reduce((s, q) => s + q.quantity, 0),
      },
      machineBoard,
      orderBoard,
      activeDowntime,
      recentQuality: quality.slice(0, 8),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to build WIP board";
    console.error("GET wip error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
