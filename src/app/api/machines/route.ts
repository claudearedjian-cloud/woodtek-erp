import { NextResponse } from "next/server";
import { db } from "@/db";
import { machines, users, orderOperations, orders } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { listMachinesForUser, listOperationsForUser, isManager as userIsManager } from "@/lib/dataAccess";
import { readMachineOperators, setMachineOperators } from "@/lib/machineOperators.server";
import { operationMachineCandidates } from "@/lib/operationMachineCandidates.server";

export async function GET(request: Request) {
  const { user, error: authError } = await authorize("machines:read");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const summaryOnly = new URL(request.url).searchParams.get("summary") === "true";
    const [scopedMachines, scopedOps] = await Promise.all([
      listMachinesForUser(user),
      listOperationsForUser(user, { statuses: ["Ready", "In Progress", "Pending"] }),
    ]);

    const crews = readMachineOperators();
    const operationsByMachine = new Map<number, typeof scopedOps>();
    for (const operation of scopedOps) {
      const stationIds = operationMachineCandidates(
        operation.id,
        operation.machineId,
        operation.status,
      );
      for (const machineId of stationIds) {
        const list = operationsByMachine.get(machineId) ?? [];
        list.push(operation);
        operationsByMachine.set(machineId, list);
      }
    }

    const enriched = scopedMachines.map(m => {
      const machineOps = operationsByMachine.get(m.id) ?? [];
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
        assignedOperatorIds: crews[String(m.id)]?.length
          ? crews[String(m.id)]
          : m.assignedOperatorId != null ? [m.assignedOperatorId] : [],
        status: displayStatus,
        activeJob,
        queueCount: machineOps.length,
        readyQueueCount,
        totalQueueMinutes: totalEstimatedMinutes,
        ...(summaryOnly ? {} : { queuedJobs: machineOps }),
      };
    });

    return NextResponse.json(enriched, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
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
    const legacyOperatorId = Number(assignedOperatorId);
    const crewIds = Array.isArray(body.assignedOperatorIds)
      ? (Array.from(new Set(body.assignedOperatorIds
          .map((value: unknown) => Number(value))
          .filter((value: number) => Number.isInteger(value) && value > 0))) as number[]).slice(0, 20)
      : Number.isInteger(legacyOperatorId) && legacyOperatorId > 0 ? [legacyOperatorId] : [];

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
      assignedOperatorId: crewIds[0] ?? null,
      notes: notes || null,
      maintenanceDue: maintenanceDue ? new Date(maintenanceDue) : null
    }).returning();

    // Multi-operator crew (Manager UI) — sync overlay + keep primary column.
    if (crewIds.length > 0) setMachineOperators(newMachine.id, crewIds);

    return NextResponse.json({ ...newMachine, assignedOperatorIds: crewIds }, { status: 201 });
  } catch (error: any) {
    console.error("POST machine error:", error);
    return NextResponse.json({ error: error?.message || "Failed to create machine" }, { status: 500 });
  }
}
