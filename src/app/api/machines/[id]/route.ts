import { NextResponse } from "next/server";
import { db } from "@/db";
import { machines, orderOperations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { readMachineOperators, removeMachineOperators, setMachineOperators } from "@/lib/machineOperators.server";
import { removeMachineFromOperationCandidates } from "@/lib/operationMachineCandidates.server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("machines:read");
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const machineId = Number(id);

    const [machine] = await db.select().from(machines).where(eq(machines.id, machineId));
    if (!machine) {
      return NextResponse.json({ error: "Machine not found" }, { status: 404 });
    }

    return NextResponse.json(machine);
  } catch (error: any) {
    console.error("GET machine error:", error);
    return NextResponse.json({ error: error?.message || "Failed to fetch machine details" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("machines:write");
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const machineId = Number(id);
    const body = await request.json();

    const updateFields: any = {};
    let pendingCrew: number[] | null = null;
    if (body.name !== undefined) updateFields.name = body.name;
    if (body.code !== undefined) updateFields.code = body.code.toUpperCase();
    if (body.category !== undefined) updateFields.category = body.category;
    if (body.status !== undefined) updateFields.status = body.status;
    if (body.hourlyCost !== undefined) updateFields.hourlyCost = String(body.hourlyCost);
    if (body.location !== undefined) updateFields.location = body.location;
    if (body.notes !== undefined) updateFields.notes = body.notes;
    if (body.assignedOperatorIds !== undefined) {
      // Crew list wins; the primary column mirrors the first crew member so
      // legacy single-operator logic keeps working.
      const crew = Array.isArray(body.assignedOperatorIds)
        ? (Array.from(new Set(body.assignedOperatorIds
            .map((x: unknown) => Number(x))
            .filter((n: number) => Number.isInteger(n) && n > 0))) as number[]).slice(0, 20)
        : [];
      updateFields.assignedOperatorId = crew.length > 0 ? crew[0] : null;
      pendingCrew = crew;
    } else if (body.assignedOperatorId !== undefined) {
      const legacyOperatorId = Number(body.assignedOperatorId);
      const validLegacyOperatorId = Number.isInteger(legacyOperatorId) && legacyOperatorId > 0 ? legacyOperatorId : null;
      updateFields.assignedOperatorId = validLegacyOperatorId;
      pendingCrew = validLegacyOperatorId ? [validLegacyOperatorId] : [];
    }
    if (body.maintenanceDue !== undefined) updateFields.maintenanceDue = body.maintenanceDue ? new Date(body.maintenanceDue) : null;

    const [updatedMachine] = await db
      .update(machines)
      .set(updateFields)
      .where(eq(machines.id, machineId))
      .returning();

    if (!updatedMachine) return NextResponse.json({ error: "Machine not found" }, { status: 404 });
    if (pendingCrew !== null) setMachineOperators(machineId, pendingCrew);
    const effectiveCrew = pendingCrew
      ?? readMachineOperators()[String(machineId)]
      ?? (updatedMachine.assignedOperatorId != null ? [updatedMachine.assignedOperatorId] : []);

    return NextResponse.json(
      { ...updatedMachine, assignedOperatorIds: effectiveCrew },
      { headers: { "Cache-Control": "private, no-store, max-age=0" } },
    );
  } catch (error: any) {
    console.error("PATCH machine error:", error);
    return NextResponse.json({ error: error?.message || "Failed to update machine" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("machines:write");
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const machineId = Number(id);

    // Unassign operations before deleting machine
    await db.update(orderOperations).set({ machineId: null }).where(eq(orderOperations.machineId, machineId));
    await db.delete(machines).where(eq(machines.id, machineId));
    removeMachineOperators(machineId);
    removeMachineFromOperationCandidates(machineId);

    return NextResponse.json({ success: true, message: "Machine deleted and scheduled operations unassigned." });
  } catch (error: any) {
    console.error("DELETE machine error:", error);
    return NextResponse.json({ error: error?.message || "Failed to delete machine" }, { status: 500 });
  }
}
