import { NextResponse } from "next/server";
import { db } from "@/db";
import { machines, users, orderOperations, orders } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { listMachinesForUser, listOperationsForUser, isManager as userIsManager } from "@/lib/dataAccess";

export async function GET() {
  const { user, error: authError } = await authorize("machines:read");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const scopedMachines = await listMachinesForUser(user);
    const scopedOps = await listOperationsForUser(user);

    const allowedMachineIds = new Set(scopedMachines.map(m => m.id));

    const enriched = scopedMachines.map(m => {
      const machineOps = scopedOps.filter(o => o.machineId === m.id && (o.status === "Ready" || o.status === "In Progress" || o.status === "Pending"));
      const activeJob = machineOps.find(o => o.status === "In Progress") || null;
      const readyQueueCount = machineOps.filter(o => o.status === "Ready").length;
      const totalEstimatedMinutes = machineOps.reduce((sum, o) => sum + (o.estimatedMinutes || 0), 0);

      let displayStatus = m.status;
      if (activeJob && displayStatus !== "Maintenance" && displayStatus !== "Offline") {
        displayStatus = "In-Use";
      }

      // Strip hourly cost from non-Managers
      const hourlyCost = userIsManager(user) ? m.hourlyCost : null;

      return {
        ...m,
        hourlyCost,
        status: displayStatus,
        activeJob,
        queueCount: machineOps.length,
        readyQueueCount,
        totalQueueMinutes: totalEstimatedMinutes,
        queuedJobs: machineOps,
      };
    });

    return NextResponse.json(enriched);
  } catch (error: any) {
    console.error("GET machines error:", error);
    return NextResponse.json({ error: error?.message || "Failed to fetch machines" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { error: authError } = await authorize("machines:write");
  if (authError) return authError;

  try {
    const body = await request.json();
    const { name, code, category, status = "Active", hourlyCost = "65.00", location = "Shop Floor", assignedOperatorId, notes, maintenanceDue } = body;

    if (!name || !code || !category) {
      return NextResponse.json({ error: "Machine Name, Code, and Category are required." }, { status: 400 });
    }

    const [newMachine] = await db.insert(machines).values({
      name,
      code: code.toUpperCase(),
      category,
      status,
      hourlyCost: String(hourlyCost),
      location,
      assignedOperatorId: assignedOperatorId ? Number(assignedOperatorId) : null,
      notes: notes || null,
      maintenanceDue: maintenanceDue ? new Date(maintenanceDue) : null
    }).returning();

    return NextResponse.json(newMachine, { status: 201 });
  } catch (error: any) {
    console.error("POST machine error:", error);
    return NextResponse.json({ error: error?.message || "Failed to create machine" }, { status: 500 });
  }
}
