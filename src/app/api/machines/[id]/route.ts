import { NextResponse } from "next/server";
import { db } from "@/db";
import { machines, orderOperations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";

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
    if (body.name !== undefined) updateFields.name = body.name;
    if (body.code !== undefined) updateFields.code = body.code.toUpperCase();
    if (body.category !== undefined) updateFields.category = body.category;
    if (body.status !== undefined) updateFields.status = body.status;
    if (body.hourlyCost !== undefined) updateFields.hourlyCost = String(body.hourlyCost);
    if (body.location !== undefined) updateFields.location = body.location;
    if (body.notes !== undefined) updateFields.notes = body.notes;
    if (body.assignedOperatorId !== undefined) updateFields.assignedOperatorId = body.assignedOperatorId ? Number(body.assignedOperatorId) : null;
    if (body.maintenanceDue !== undefined) updateFields.maintenanceDue = body.maintenanceDue ? new Date(body.maintenanceDue) : null;

    const [updatedMachine] = await db
      .update(machines)
      .set(updateFields)
      .where(eq(machines.id, machineId))
      .returning();

    return NextResponse.json(updatedMachine);
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

    return NextResponse.json({ success: true, message: "Machine deleted and scheduled operations unassigned." });
  } catch (error: any) {
    console.error("DELETE machine error:", error);
    return NextResponse.json({ error: error?.message || "Failed to delete machine" }, { status: 500 });
  }
}
