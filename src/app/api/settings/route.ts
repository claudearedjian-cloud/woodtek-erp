import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, customers } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { authorize, hashPin } from "@/lib/auth";
import { baseRoleOf } from "@/lib/permissions";
import { ensureRolesRegistered } from "@/lib/rolesConfig.server";

const SAFE_USER_COLUMNS = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  avatarColor: users.avatarColor,
  active: users.active,
  phone: users.phone,
  notes: users.notes,
  createdAt: users.createdAt,
};

export async function GET(request: Request) {
  const { error: authError } = await authorize("users:read");
  if (authError) return authError;

  try {
    ensureRolesRegistered();
    const url = new URL(request.url);
    const entityType = url.searchParams.get("entity");
    const entityId = url.searchParams.get("entityId");

    if (entityType === "users" || entityType === "operators" || entityType === "technicians") {
      let allUsers = await db.select(SAFE_USER_COLUMNS).from(users).orderBy(asc(users.name));
      
      if (entityType === "operators") {
        allUsers = allUsers.filter(u => baseRoleOf(u.role) === "Machine Operator");
      } else if (entityType === "technicians") {
        allUsers = allUsers.filter(u => baseRoleOf(u.role) === "Technician");
      } else if (entityType === "users") {
        // All users
      }

      if (entityId) {
        const user = allUsers.find(u => String(u.id) === entityId);
        if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
        return NextResponse.json(user);
      }

      return NextResponse.json(allUsers);
    }

    if (entityType === "clients") {
      let allClients = await db.select().from(customers).orderBy(asc(customers.company));
      if (entityId) {
        const client = allClients.find(c => String(c.id) === entityId);
        if (!client) return NextResponse.json({ error: "Client not found" }, { status: 404 });
        return NextResponse.json(client);
      }
      return NextResponse.json(allClients);
    }

    // Default: return summary
    const allUsers = await db.select(SAFE_USER_COLUMNS).from(users);
    const allClients = await db.select().from(customers);
    return NextResponse.json({
      users: allUsers,
      clients: allClients,
      summary: {
        totalUsers: allUsers.length,
        totalClients: allClients.length,
        operators: allUsers.filter(u => baseRoleOf(u.role) === "Machine Operator").length,
        technicians: allUsers.filter(u => baseRoleOf(u.role) === "Technician").length,
        managers: allUsers.filter(u => baseRoleOf(u.role) === "Manager").length,
      }
    });
  } catch (error: any) {
    console.error("GET settings error:", error);
    return NextResponse.json({ error: error?.message || "Failed to fetch settings" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { error: authError } = await authorize("users:manage");
  if (authError) return authError;

  try {
    const body = await request.json();
    const { entityType, data } = body;

    if (entityType === "users" || entityType === "operators" || entityType === "technicians") {
      const { id, name, email, role, avatarColor, pin, active, phone, notes } = data;
      
      // Validate PIN for new users
      if (!id && (!pin || !/^\d{4}$/.test(pin))) {
        return NextResponse.json({ error: "A four-digit PIN is required for new users." }, { status: 400 });
      }

      if (id) {
        // Update existing
        const updateData: any = { name, email, avatarColor, active, phone, notes };
        if (role) updateData.role = role;
        if (pin) {
          if (!/^\d{4}$/.test(String(pin))) {
            return NextResponse.json({ error: "PIN must be exactly four digits." }, { status: 400 });
          }
          updateData.pin = await hashPin(String(pin));
        }
        
        const [updated] = await db.update(users).set(updateData).where(eq(users.id, Number(id))).returning(SAFE_USER_COLUMNS);
        return NextResponse.json(updated);
      } else {
        // Create new
        const finalRole = entityType === "operators" ? "Machine Operator" : entityType === "technicians" ? "Technician" : role || "Machine Operator";
        const [created] = await db.insert(users).values({
          name,
          email,
          role: finalRole,
          avatarColor: avatarColor || "bg-slate-600",
          pin: await hashPin(String(pin)),
          active: active !== false,
          phone,
          notes,
        }).returning(SAFE_USER_COLUMNS);
        return NextResponse.json(created, { status: 201 });
      }
    }

    if (entityType === "clients") {
      const { id, name, company, email, phone, address, creditLimit, currentBalance, notes } = data;

      if (id) {
        // Update existing
        const updateData: any = { name, company, email, phone, address, notes };
        if (creditLimit) updateData.creditLimit = String(creditLimit);
        if (currentBalance) updateData.currentBalance = String(currentBalance);
        
        const [updated] = await db.update(customers).set(updateData).where(eq(customers.id, Number(id))).returning();
        return NextResponse.json(updated);
      } else {
        // Create new
        if (!name || !company || !email || !phone) {
          return NextResponse.json({ error: "Name, company, email and phone are required." }, { status: 400 });
        }
        const [created] = await db.insert(customers).values({
          name,
          company,
          email,
          phone,
          address: address || "",
          creditLimit: String(creditLimit || "15000.00"),
          currentBalance: "0.00",
          notes,
        }).returning();
        return NextResponse.json(created, { status: 201 });
      }
    }

    return NextResponse.json({ error: "Invalid entity type" }, { status: 400 });
  } catch (error: any) {
    console.error("POST settings error:", error);
    if (error.message?.includes("duplicate key")) {
      return NextResponse.json({ error: "A record with this email already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: error?.message || "Failed to save" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const { error: authError } = await authorize("users:manage");
  if (authError) return authError;

  try {
    const url = new URL(request.url);
    const entityType = url.searchParams.get("entity");
    const entityId = url.searchParams.get("entityId");

    if (!entityType || !entityId) {
      return NextResponse.json({ error: "Entity type and ID required" }, { status: 400 });
    }

    if (entityType === "users" || entityType === "operators" || entityType === "technicians") {
      // Check if user has assigned operations
      const { orderOperations } = await import("@/db/schema");
      const { eq: eqOp } = await import("drizzle-orm");
      const userOps = await db.select().from(orderOperations).where(eqOp(orderOperations.operatorId, Number(entityId)));
      if (userOps.length > 0) {
        return NextResponse.json({ error: "Cannot delete user with assigned operations. Deactivate instead." }, { status: 400 });
      }
      await db.delete(users).where(eq(users.id, Number(entityId)));
      return NextResponse.json({ success: true });
    }

    if (entityType === "clients") {
      const { orders } = await import("@/db/schema");
      const { eq: eqOrd } = await import("drizzle-orm");
      const clientOrders = await db.select().from(orders).where(eqOrd(orders.customerId, Number(entityId)));
      if (clientOrders.length > 0) {
        return NextResponse.json({ error: "Cannot delete client with existing orders." }, { status: 400 });
      }
      await db.delete(customers).where(eq(customers.id, Number(entityId)));
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid entity type" }, { status: 400 });
  } catch (error: any) {
    console.error("DELETE settings error:", error);
    return NextResponse.json({ error: error?.message || "Failed to delete" }, { status: 500 });
  }
}
