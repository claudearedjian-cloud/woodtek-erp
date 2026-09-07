import { NextResponse } from "next/server";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { listCustomersForUser, isManager as userIsManager, isFloorRole } from "@/lib/dataAccess";

export async function GET() {
  const { user, error: authError } = await authorize("customers:read");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const scoped = await listCustomersForUser(user);

    // Enrich with order stats (within the user's scope)
    const userOrderIds = userIsManager(user)
      ? null
      : new Set((await db.select({ id: orders.id }).from(orders)).map(o => o.id));

    // For non-Managers, only count orders the user can see
    const relevantOrders = userIsManager(user)
      ? await db.select().from(orders)
      : (await db.select().from(orders)).filter(o => userOrderIds?.has(o.id));

    const enriched = scoped.map(c => {
      const custOrders = relevantOrders.filter(o => o.customerId === c.id);
      const activeOrdersCount = custOrders.filter(o => o.status !== "Completed" && o.status !== "On Hold").length;
      const totalSpend = custOrders.reduce((sum, o) => sum + parseFloat(o.totalValue || "0"), 0);
      return {
        ...c,
        orderCount: custOrders.length,
        activeOrdersCount,
        totalSpend: isFloorRole(user) ? null : totalSpend.toFixed(2),
      };
    });

    return NextResponse.json(enriched);
  } catch (error: any) {
    console.error("GET customers error:", error);
    return NextResponse.json({ error: error?.message || "Failed to fetch customers" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { user, error: authError } = await authorize("customers:write");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { name, company, email, phone, address = "", creditLimit = "15000.00", notes = "" } = body;

    if (!name || !company || !email || !phone) {
      return NextResponse.json({ error: "Name, Company, Email and Phone are required." }, { status: 400 });
    }

    // Sales users creating a customer: auto-assign to themselves.
    // Managers can optionally pass assignedSalesId in the body.
    const assignedSalesId = user.role === "Sales Coordinator"
      ? user.id
      : (body.assignedSalesId ? Number(body.assignedSalesId) : null);

    const [newCustomer] = await db.insert(customers).values({
      name,
      company,
      email,
      phone,
      address,
      creditLimit: String(creditLimit),
      currentBalance: "0.00",
      notes,
      assignedSalesId,
    }).returning();

    return NextResponse.json(newCustomer, { status: 201 });
  } catch (error: any) {
    console.error("POST customer error:", error);
    return NextResponse.json({ error: error?.message || "Failed to create customer" }, { status: 500 });
  }
}
