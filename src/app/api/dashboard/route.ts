import { NextResponse } from "next/server";
import { db } from "@/db";
import { orders, machines, orderOperations, inventoryItems, customers, users } from "@/db/schema";
import { eq, desc, asc } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import {
  listOrdersForUser,
  listMachinesForUser,
  listOperationsForUser,
  listCustomersForUser,
  listDowntimeEventsForUser,
  listQualityEventsForUser,
  isManager as userIsManager,
  isFloorRole,
} from "@/lib/dataAccess";

export async function GET(request: Request) {
  const { user, error: authError } = await authorize();
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [orderRows, machineRows, opRows, invRows, customerRows, downtimeRows, qualityRows] = await Promise.all([
      listOrdersForUser(user),
      listMachinesForUser(user),
      listOperationsForUser(user),
      db.select().from(inventoryItems),
      listCustomersForUser(user),
      listDowntimeEventsForUser(user),
      listQualityEventsForUser(user),
    ]);

    // ---- OEE time window ----------------------------------------------------
    const url = new URL(request.url);
    const windowParam = (url.searchParams.get("window") || "7d").toLowerCase();
    const now = new Date();
    let windowStart: Date;
    let windowLabel: string;
    if (windowParam === "today") {
      windowStart = new Date(now);
      windowStart.setHours(0, 0, 0, 0);
      windowLabel = "Today";
    } else if (windowParam === "30d") {
      windowStart = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
      windowLabel = "Last 30 days";
    } else {
      windowStart = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
      windowLabel = "Last 7 days";
    }
    const windowMinutes = Math.max(60, Math.round((now.getTime() - windowStart.getTime()) / 60000));

    // ---- Availability (from downtime events) --------------------------------
    const minutesOfDowntime = (d: any) =>
      d.durationMinutes > 0
        ? d.durationMinutes
        : Math.max(0, Math.round(((d.endedAt ? new Date(d.endedAt) : now).getTime() - new Date(d.startedAt).getTime()) / 60000));

    const downtimeInWindow = downtimeRows.filter(d => new Date(d.startedAt) >= windowStart);
    const totalDowntimeMinutes = downtimeInWindow.reduce((s, d) => s + minutesOfDowntime(d), 0);
    const machineCount = machineRows.length;
    const availabilityFrac = machineCount > 0
      ? Math.max(0, Math.min(1, 1 - totalDowntimeMinutes / (machineCount * windowMinutes)))
      : null;

    const machineAvailability = machineRows
      .map(m => {
        const mins = downtimeInWindow.filter(d => d.machineId === m.id).reduce((s, d) => s + minutesOfDowntime(d), 0);
        const availability = Math.max(0, Math.min(100, Math.round((1 - mins / windowMinutes) * 100)));
        return { machineId: m.id, code: m.code, name: m.name, downtimeMinutes: mins, availability };
      })
      .sort((a, b) => a.availability - b.availability)
      .slice(0, 5);

    // ---- Performance (estimated vs actual on completed ops) -----------------
    const completedInWindow = opRows.filter(o => o.status === "Completed" && o.endTime && new Date(o.endTime) >= windowStart);
    const measured = completedInWindow.filter(o => (o.actualMinutes || 0) > 0);
    const estSum = measured.reduce((s, o) => s + (o.estimatedMinutes || 0), 0);
    const actSum = measured.reduce((s, o) => s + (o.actualMinutes || 0), 0);
    const performanceFrac = measured.length > 0 && actSum > 0 ? Math.min(1, estSum / actSum) : null;

    // ---- Quality (first-pass yield on operations) ---------------------------
    const rejectedOps = opRows.filter(o => o.status === "Rejected/Rework" || o.rejectReason);
    const completedOpsAll = opRows.filter(o => o.status === "Completed");
    const routed = completedOpsAll.length + rejectedOps.length;
    const qualityFrac = routed > 0 ? completedOpsAll.length / routed : null;

    // ---- Scrap & rework signals (from quality events) -----------------------
    const scrapInWindow = qualityRows.filter(q => q.eventType === "scrap" && new Date(q.createdAt) >= windowStart);
    const scrapQty = scrapInWindow.reduce((s, q) => s + (q.quantity || 0), 0);
    const scrapCost = Math.round(scrapInWindow.reduce((s, q) => s + (parseFloat(String(q.estimatedCost || "0")) || 0) * (q.quantity || 1), 0));
    const openRework = qualityRows.filter(q => q.eventType === "rework" && (q.disposition === "Open" || q.disposition === "In Rework")).length;

    const pct = (f: number | null) => (f == null ? null : Math.round(f * 100));
    const availabilityPct = pct(availabilityFrac);
    const performancePct = pct(performanceFrac);
    const qualityPct = pct(qualityFrac);
    const oeePct = availabilityFrac != null && performanceFrac != null && qualityFrac != null
      ? Math.round(availabilityFrac * performanceFrac * qualityFrac * 100)
      : null;

    const oee = {
      window: windowParam,
      windowLabel,
      oee: oeePct,
      availability: availabilityPct,
      performance: performancePct,
      quality: qualityPct,
      totalDowntimeMinutes,
      totalDowntimeHours: Math.round((totalDowntimeMinutes / 60) * 10) / 10,
      scrapQty,
      scrapCost,
      openRework,
      completedOps: completedInWindow.length,
      rejectedOps: rejectedOps.length,
      machineAvailability,
    };

    // Order KPIs
    const activeStatuses = new Set(["In Production", "Pending", "Quality Review"]);
    const activeOrders = orderRows.filter(o => activeStatuses.has(o.status));
    const totalPipelineValue = activeOrders.reduce(
      (s, o) => s + (o.totalValue ? parseFloat(o.totalValue) : 0),
      0,
    );
    const urgentOrdersCount = activeOrders.filter(o => o.priority === "Urgent" || o.priority === "High").length;
    const completedThisMonth = orderRows.filter(o => o.status === "Completed").length;

    // Machine Utilization & Bottleneck Analysis
    const totalMachines = machineRows.length;
    const inUseMachines = machineRows.filter(m => {
      const activeJob = opRows.find(o => o.machineId === m.id && o.status === "In Progress");
      return activeJob || m.status === "In-Use";
    }).length;

    const maintenanceMachines = machineRows.filter(m => m.status === "Maintenance" || m.status === "Offline").length;
    const utilizationRate = totalMachines > 0 ? Math.round((inUseMachines / totalMachines) * 100) : 0;

    // Bottlenecks: Find machines with highest number of "Ready" or "In Progress" steps
    const machineWorkloads = machineRows.map(m => {
      const queue = opRows.filter(o => o.machineId === m.id && (o.status === "Ready" || o.status === "In Progress"));
      const totalMinutes = queue.reduce((s, o) => s + (o.estimatedMinutes || 0), 0);
      return {
        machineId: m.id,
        name: m.name,
        code: m.code,
        category: m.category,
        status: m.status,
        queueLength: queue.length,
        estimatedHours: Math.round((totalMinutes / 60) * 10) / 10,
        hourlyCost: userIsManager(user) ? m.hourlyCost : null,
      };
    }).sort((a, b) => b.queueLength - a.queueLength);

    const primaryBottleneck = machineWorkloads.find(m => m.queueLength > 0) || null;

    // Inventory Alerts
    const lowStockItems = invRows.filter(i => i.stockQuantity <= i.reorderLevel);

    // Recent Operational Activity
    const activeShopJobs = opRows.filter(o => o.status === "In Progress" || o.status === "Ready").slice(0, 6);

    return NextResponse.json({
      kpis: {
        activeOrdersCount: activeOrders.length,
        totalPipelineValue: isFloorRole(user) ? null : totalPipelineValue.toFixed(2),
        urgentOrdersCount,
        completedOrdersCount: completedThisMonth,
        utilizationRate,
        inUseMachines,
        totalMachines,
        maintenanceMachines,
        customerCount: customerRows.length,
        inventoryAlertsCount: lowStockItems.length,
      },
      machineWorkloads,
      primaryBottleneck,
      lowStockItems: lowStockItems.slice(0, 5),
      activeShopJobs,
      orderStatusDistribution: {
        Pending: orderRows.filter(o => o.status === "Pending").length,
        InProduction: orderRows.filter(o => o.status === "In Production").length,
        QualityReview: orderRows.filter(o => o.status === "Quality Review").length,
        Completed: orderRows.filter(o => o.status === "Completed").length,
        OnHold: orderRows.filter(o => o.status === "On Hold").length,
      },
      oee,
    });
  } catch (error: any) {
    console.error("GET dashboard metrics error:", error);
    return NextResponse.json({ error: error?.message || "Failed to compute dashboard metrics" }, { status: 500 });
  }
}
