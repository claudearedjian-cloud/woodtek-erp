import { NextResponse } from "next/server";
import { db } from "@/db";
import { customers, orders, users } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { canSeeCustomerForUser } from "@/lib/dataAccess";
import { canOwnClients, isManagerViewer } from "@/lib/clientOwnership";
import { canSeeMoney } from "@/lib/optionalModules";
import { readOptionalModules } from "@/lib/optionalModules.server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error: authError } = await authorize("customers:read");
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const [customer] = await db.select().from(customers).where(eq(customers.id, Number(id)));
    if (!customer) return NextResponse.json({ error: "Customer not found" }, { status: 404 });

    // Same record-level rule as the client list: opening a client file by id
    // must not be a way around the client book scope.
    if (user && !(await canSeeCustomerForUser(user, customer.id))) {
      return NextResponse.json(
        { error: "This client is not in your client book — it belongs to another sales rep." },
        { status: 403 },
      );
    }

    const customerOrders = await db.select().from(orders).where(eq(orders.customerId, customer.id)).orderBy(desc(orders.createdAt));

    // Money is hidden in the API, not just on screen: without the Invoicing &
    // Money grant the credit limit, the balance and every order value are
    // blanked before the response leaves the server.
    const money = canSeeMoney(user, readOptionalModules());
    const safeOrders = money
      ? customerOrders
      : customerOrders.map((o) => ({ ...o, totalValue: null as unknown as string }));
    const safeCustomer = money
      ? customer
      : { ...customer, creditLimit: null as unknown as string, currentBalance: null as unknown as string };

    return NextResponse.json({ ...safeCustomer, orders: safeOrders });
  } catch (error: any) {
    console.error("GET customer details error:", error);
    return NextResponse.json({ error: error?.message || "Failed to fetch customer" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error: authError } = await authorize("customers:write");
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const [existing] = await db.select().from(customers).where(eq(customers.id, Number(id)));
    if (!existing) return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    // Editing a client file follows the same scope as reading it.
    if (user && !(await canSeeCustomerForUser(user, existing.id))) {
      return NextResponse.json(
        { error: "This client is not in your client book — it belongs to another sales rep." },
        { status: 403 },
      );
    }

    // Writing money is a grant, not a role: without Invoicing & Money a user can
    // edit a client's contact details but never its limit or balance.
    if ((body.creditLimit !== undefined || body.currentBalance !== undefined)
      && !canSeeMoney(user, readOptionalModules())) {
      return NextResponse.json(
        { error: "Credit limit and balance belong to Invoicing & Money. Ask a Manager to grant it in Settings > System Settings > Optional modules." },
        { status: 403 },
      );
    }

    const updateFields: any = {};
    if (body.name !== undefined) updateFields.name = body.name;
    if (body.company !== undefined) updateFields.company = body.company;
    if (body.email !== undefined) updateFields.email = body.email;
    if (body.phone !== undefined) updateFields.phone = body.phone;
    if (body.address !== undefined) updateFields.address = body.address;
    if (body.creditLimit !== undefined) updateFields.creditLimit = String(body.creditLimit);
    if (body.currentBalance !== undefined) updateFields.currentBalance = String(body.currentBalance);
    if (body.notes !== undefined) updateFields.notes = body.notes;

    // Who owns the client relationship — Managers hand the account to a sales
    // rep (or release it back to the shared pool). A Sales Coordinator cannot
    // take a colleague's client with a hand-crafted request: the field is
    // refused outright, not silently ignored.
    if (body.assignedSalesId !== undefined) {
      if (!isManagerViewer(user)) {
        return NextResponse.json(
          { error: "Only a Manager can change the assigned sales rep of a client." },
          { status: 403 },
        );
      }
      const rawOwner = body.assignedSalesId;
      if (rawOwner === null || rawOwner === "" || rawOwner === undefined) {
        updateFields.assignedSalesId = null;
      } else {
        const ownerId = Number(rawOwner);
        if (!Number.isInteger(ownerId) || ownerId <= 0) {
          return NextResponse.json({ error: "Invalid sales rep." }, { status: 400 });
        }
        const [owner] = await db
          .select({ id: users.id, role: users.role })
          .from(users)
          .where(eq(users.id, ownerId));
        if (!owner) return NextResponse.json({ error: "That user no longer exists." }, { status: 404 });
        if (!canOwnClients(owner.role)) {
          return NextResponse.json(
            { error: "Only a Manager or a Sales Coordinator can own a client file." },
            { status: 400 },
          );
        }
        updateFields.assignedSalesId = ownerId;
      }
    }

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
