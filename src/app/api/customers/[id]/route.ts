import { NextResponse } from "next/server";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { authorize } from "@/lib/auth";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("customers:read");
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const [customer] = await db.select().from(customers).where(eq(customers.id, Number(id)));
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    const customerOrders = await db.select().from(orders).where(eq(orders.customerId, customer.id)).orderBy(desc(orders.createdAt));
    return NextResponse.json({ ...customer, orders: customerOrders });
  } catch (error: any) {
    console.error("GET customer details error:", error);
    return NextResponse.json({ error: error?.message || "Failed to fetch customer" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("customers:write");
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const updateFields: any = {};
    if (body.name !== undefined) updateFields.name = body.name;
    if (body.company !== undefined) updateFields.company = body.company;
    if (body.email !== undefined) updateFields.email = body.email;
    if (body.phone !== undefined) updateFields.phone = body.phone;
    if (body.address !== undefined) updateFields.address = body.address;
    if (body.creditLimit !== undefined) updateFields.creditLimit = String(body.creditLimit);
    if (body.currentBalance !== undefined) updateFields.currentBalance = String(body.currentBalance);
    if (body.notes !== undefined) updateFields.notes = body.notes;

    const [updated] = await db.update(customers).set(updateFields).where(eq(customers.id, Number(id))).returning();
    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("PATCH customer error:", error);
    return NextResponse.json({ error: error?.message || "Failed to update customer" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("customers:delete");
  if (authError) return authError;

  try {
    const { id } = await context.params;
    // Check if customer has active orders
    const custOrders = await db.select().from(orders).where(eq(orders.customerId, Number(id)));
    if (custOrders.length > 0) {
      return NextResponse.json({ error: "Cannot delete customer with existing production orders." }, { status: 400 });
    }

    await db.delete(customers).where(eq(customers.id, Number(id)));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE customer error:", error);
    return NextResponse.json({ error: error?.message || "Failed to delete customer" }, { status: 500 });
  }
}
