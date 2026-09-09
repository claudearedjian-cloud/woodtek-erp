// src/lib/dataAccess.ts
// ============================================================================
// Single source of truth for record-level data isolation.
//
// Every list/get query for a protected entity (orders, customers, machines,
// operations) must go through this module. It applies three layers of
// scoping, in order:
//   1. ROLE-BASED MODULE ACCESS  - which modules a role can see at all
//                                   (see moduleAccess.ts)
//   2. RECORD-LEVEL SCOPING      - which records a user can see
//   3. FIELD-LEVEL REDACTION     - which fields are hidden from non-Managers
//
// All helpers are pure server-side: they take a SessionUser and return the
// rows that user is allowed to see. The client never makes the scoping
// decision - the server is the enforcement point.
// ============================================================================

import { db } from "@/db";
import {
  orders,
  customers,
  orderOperations,
  machines,
  users,
  inventoryItems,
  assets,
  maintenanceLogs,
  qualityEvents,
  downtimeEvents,
} from "@/db/schema";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { SessionUser } from "@/lib/auth";

// -------------------------------------------------------------------- types

export type Role = SessionUser["role"];

export type ScopedOrder = typeof orders.$inferSelect & {
  customerName: string | null;
  customerCompany: string | null;
  assignedSalesName: string | null;
  createdByName: string | null;
};

export type ScopedCustomer = typeof customers.$inferSelect & {
  assignedSalesName: string | null;
};

export type ScopedMachine = typeof machines.$inferSelect & {
  assignedOperatorName: string | null;
};

export type ScopedOperation = typeof orderOperations.$inferSelect & {
  machineName: string | null;
  machineCode: string | null;
  operatorName: string | null;
  orderTitle: string | null;
  orderNumber: string | null;
  customerId: number | null;
};

// -------------------------------------------------------------------- helpers

function isManager(user: SessionUser): boolean {
  return user.role === "Manager";
}

/**
 * Floor roles (Machine Operator, QA & Dispatch, Technician) are restricted
 * from commercial/financial data (order quote values, material costs).
 * Managers and Sales Coordinators see financials (Sales quotes the orders).
 */
export function isFloorRole(user: SessionUser | { role: string } | null | undefined): boolean {
  if (!user) return false;
  return (
    user.role === "Machine Operator" ||
    user.role === "QA & Dispatch" ||
    user.role === "Technician"
  );
}

export { isManager };

/**
 * Subquery: returns the set of order IDs the user is allowed to see.
 * Centralised so every list query uses the exact same logic.
 */
async function allowedOrderIdsSubquery(user: SessionUser) {
  if (isManager(user)) return undefined; // Manager: no extra WHERE clause

  if (user.role === "Sales Coordinator") {
    // Sales sees only orders they created OR that are assigned to them
    return db
      .select({ id: orders.id })
      .from(orders)
      .where(
        or(
          eq(orders.createdById, user.id),
          eq(orders.assignedSalesId, user.id),
        ),
      );
  }

  if (user.role === "QA & Dispatch") {
    // QA & Dispatch sees orders in review or completed
    return db
      .select({ id: orders.id })
      .from(orders)
      .where(
        or(
          eq(orders.status, "Quality Review"),
          eq(orders.status, "Completed"),
          eq(orders.status, "Delivered"),
          eq(orders.status, "In Production"),
        ),
      );
  }

  if (user.role === "Machine Operator") {
    // Operators see orders they're actively working OR that are routed to
    // a machine they're assigned to.
    const directOps = db
      .select({ id: orderOperations.orderId })
      .from(orderOperations)
      .where(eq(orderOperations.operatorId, user.id));

    const machineOps = db
      .select({ id: orderOperations.orderId })
      .from(orderOperations)
      .innerJoin(machines, eq(orderOperations.machineId, machines.id))
      .where(eq(machines.assignedOperatorId, user.id));

    const directIds = await directOps;
    const machineIds = await machineOps;
    const all = Array.from(new Set([...directIds, ...machineIds].map(r => r.id))).filter((n): n is number => typeof n === "number");
    if (all.length === 0) {
      // Force zero results via a sentinel id that cannot exist
      return db.select({ id: orders.id }).from(orders).where(eq(orders.id, -1));
    }
    return db.select({ id: orders.id }).from(orders).where(inArray(orders.id, all));
  }

  if (user.role === "Technician") {
    // Technicians do not see orders - they see machines, assets, CMMS only.
    return db.select({ id: orders.id }).from(orders).where(eq(orders.id, -1));
  }

  // Default deny
  return db.select({ id: orders.id }).from(orders).where(eq(orders.id, -1));
}

async function allowedCustomerIdsSubquery(user: SessionUser) {
  if (isManager(user)) return undefined;
  if (user.role === "Sales Coordinator") {
    return db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.assignedSalesId, user.id));
  }
  // Operators, QA, Technicians: no customer access
  return db.select({ id: customers.id }).from(customers).where(eq(customers.id, -1));
}

async function allowedMachineIdsSubquery(user: SessionUser) {
  if (isManager(user)) return undefined;
  if (user.role === "Machine Operator") {
    // Operator sees only machines they are assigned to
    return db
      .select({ id: machines.id })
      .from(machines)
      .where(eq(machines.assignedOperatorId, user.id));
  }
  if (user.role === "Technician") {
    // Technicians see all machines (CMMS responsibility)
    return undefined;
  }
  // Sales, QA: no machine access
  return db.select({ id: machines.id }).from(machines).where(eq(machines.id, -1));
}

// -------------------------------------------------------------------- ORDERS

export async function listOrdersForUser(
  user: SessionUser,
  filters?: { status?: string; limit?: number },
): Promise<ScopedOrder[]> {
  const allowedIds = await allowedOrderIdsSubquery(user);

  const baseQuery = db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      customerId: orders.customerId,
      title: orders.title,
      projectType: orders.projectType,
      priority: orders.priority,
      status: orders.status,
      totalValue: orders.totalValue,
      dueDate: orders.dueDate,
      progressPercent: orders.progressPercent,
      notes: orders.notes,
      createdById: orders.createdById,
      assignedSalesId: orders.assignedSalesId,
      createdAt: orders.createdAt,
      customerName: customers.name,
      customerCompany: customers.company,
      assignedSalesName: users.name,
    })
    .from(orders)
    .leftJoin(customers, eq(orders.customerId, customers.id))
    .leftJoin(users, eq(orders.assignedSalesId, users.id))
    .orderBy(desc(orders.createdAt));

  const whereClauses = [];
  if (allowedIds) {
    const ids = (await allowedIds).map(r => r.id);
    if (ids.length === 0) return [];
    whereClauses.push(inArray(orders.id, ids));
  }
  if (filters?.status && filters.status !== "All") {
    whereClauses.push(eq(orders.status, filters.status));
  }

  const rows = await (whereClauses.length > 0
    ? baseQuery.where(and(...whereClauses))
    : baseQuery);

  let scoped = rows.map(r => ({
    ...r,
    // The 'createdByName' field below is best-effort - we don't have a join
    // for it above to keep the query simple. We backfill from a second
    // query only when needed.
    createdByName: null as string | null,
  }));

  // Field-level redaction: hide financial fields (order quote value) from
  // floor roles only (Machine Operator, QA & Dispatch, Technician).
  // Managers and Sales Coordinators see order values (Sales quotes them).
  if (isFloorRole(user)) {
    scoped = scoped.map(o => ({ ...o, totalValue: null as unknown as string }));
  }

  return scoped as ScopedOrder[];
}

export async function getOrderForUser(user: SessionUser, orderId: number): Promise<ScopedOrder | null> {
  const row = await listOrdersForUser(user);
  const found = row.find(o => o.id === orderId);
  return found ?? null;
}

// -------------------------------------------------------------------- CUSTOMERS

export async function listCustomersForUser(user: SessionUser): Promise<ScopedCustomer[]> {
  const allowedIds = await allowedCustomerIdsSubquery(user);

  const baseQuery = db
    .select({
      id: customers.id,
      name: customers.name,
      company: customers.company,
      email: customers.email,
      phone: customers.phone,
      address: customers.address,
      creditLimit: customers.creditLimit,
      currentBalance: customers.currentBalance,
      notes: customers.notes,
      assignedSalesId: customers.assignedSalesId,
      createdAt: customers.createdAt,
      assignedSalesName: users.name,
    })
    .from(customers)
    .leftJoin(users, eq(customers.assignedSalesId, users.id))
    .orderBy(asc(customers.name));

  const whereClauses = [];
  if (allowedIds) {
    const ids = (await allowedIds).map(r => r.id);
    if (ids.length === 0) return [];
    whereClauses.push(inArray(customers.id, ids));
  }
  const rows = await (whereClauses.length > 0
    ? baseQuery.where(and(...whereClauses))
    : baseQuery);

  if (isManager(user)) return rows as ScopedCustomer[];

  // Field-level redaction: hide credit limits and balances from non-Managers
  return rows.map(c => ({
    ...c,
    creditLimit: null as unknown as string,
    currentBalance: null as unknown as string,
  })) as ScopedCustomer[];
}

export async function getCustomerForUser(user: SessionUser, customerId: number): Promise<ScopedCustomer | null> {
  const all = await listCustomersForUser(user);
  return all.find(c => c.id === customerId) ?? null;
}

// -------------------------------------------------------------------- MACHINES

export async function listMachinesForUser(user: SessionUser): Promise<ScopedMachine[]> {
  const allowedIds = await allowedMachineIdsSubquery(user);

  const baseQuery = db
    .select({
      id: machines.id,
      name: machines.name,
      code: machines.code,
      category: machines.category,
      status: machines.status,
      hourlyCost: machines.hourlyCost,
      location: machines.location,
      maintenanceDue: machines.maintenanceDue,
      assignedOperatorId: machines.assignedOperatorId,
      notes: machines.notes,
      createdAt: machines.createdAt,
      assignedOperatorName: users.name,
    })
    .from(machines)
    .leftJoin(users, eq(machines.assignedOperatorId, users.id))
    .orderBy(asc(machines.name));

  const whereClauses = [];
  if (allowedIds) {
    const ids = (await allowedIds).map(r => r.id);
    if (ids.length === 0) return [];
    whereClauses.push(inArray(machines.id, ids));
  }
  const rows = await (whereClauses.length > 0
    ? baseQuery.where(and(...whereClauses))
    : baseQuery);

  if (isManager(user)) return rows as ScopedMachine[];

  // Hide hourly cost from non-Managers
  return rows.map(m => ({
    ...m,
    hourlyCost: null as unknown as string,
  })) as ScopedMachine[];
}

// -------------------------------------------------------------------- OPERATIONS

/**
 * Operations are always accessed through an order they belong to, so we
 * scope by the order first. If the user can't see the parent order, they
 * can't see the operations either.
 */
export async function listOperationsForUser(
  user: SessionUser,
  filters?: { orderId?: number },
): Promise<ScopedOperation[]> {
  const allowedOrderIds = await allowedOrderIdsSubquery(user);
  const ids = allowedOrderIds ? (await allowedOrderIds).map(r => r.id) : null;
  if (ids && ids.length === 0) return [];

  const whereClauses = [];
  if (ids) whereClauses.push(inArray(orderOperations.orderId, ids));
  if (filters?.orderId) whereClauses.push(eq(orderOperations.orderId, filters.orderId));

  const rows = await db
    .select({
      id: orderOperations.id,
      orderId: orderOperations.orderId,
      machineId: orderOperations.machineId,
      stepOrder: orderOperations.stepOrder,
      operationName: orderOperations.operationName,
      estimatedMinutes: orderOperations.estimatedMinutes,
      actualMinutes: orderOperations.actualMinutes,
      status: orderOperations.status,
      operatorId: orderOperations.operatorId,
      startTime: orderOperations.startTime,
      endTime: orderOperations.endTime,
      scheduledStart: orderOperations.scheduledStart,
      scheduledEnd: orderOperations.scheduledEnd,
      qualityNotes: orderOperations.qualityNotes,
      rejectReason: orderOperations.rejectReason,
      updatedAt: orderOperations.updatedAt,
      machineName: machines.name,
      machineCode: machines.code,
      operatorName: users.name,
      orderTitle: orders.title,
      orderNumber: orders.orderNumber,
      customerId: orders.customerId,
    })
    .from(orderOperations)
    .leftJoin(machines, eq(orderOperations.machineId, machines.id))
    .leftJoin(users, eq(orderOperations.operatorId, users.id))
    .leftJoin(orders, eq(orderOperations.orderId, orders.id))
    .where(whereClauses.length > 0 ? and(...whereClauses) : undefined)
    .orderBy(asc(orderOperations.stepOrder));

  return rows as ScopedOperation[];
}

// -------------------------------------------------------------------- DASHBOARD

export type DashboardKpis = {
  activeOrdersCount: number;
  totalPipelineValue: string;
  urgentOrdersCount: number;
  completedOrdersCount: number;
  utilizationRate: number;
  inUseMachines: number;
  totalMachines: number;
  maintenanceMachines: number;
  customerCount: number;
  inventoryAlertsCount: number;
};

export async function computeDashboardKpisForUser(user: SessionUser): Promise<DashboardKpis> {
  const [orderRows, machineRows, opRows, invRows, customerRows] = await Promise.all([
    listOrdersForUser(user),
    listMachinesForUser(user),
    listOperationsForUser(user),
    db.select().from(inventoryItems),
    listCustomersForUser(user),
  ]);

  const activeStatuses = new Set(["In Production", "Pending", "Quality Review"]);
  const activeOrders = orderRows.filter(o => activeStatuses.has(o.status));
  const totalPipelineValue = activeOrders.reduce(
    (s, o) => s + (o.totalValue ? parseFloat(o.totalValue) : 0),
    0,
  );
  const urgent = activeOrders.filter(o => o.priority === "Urgent" || o.priority === "High").length;
  const completed = orderRows.filter(o => o.status === "Completed" || o.status === "Delivered").length;

  const inUseMachines = machineRows.filter(m => {
    const busy = opRows.some(o => o.machineId === m.id && o.status === "In Progress");
    return busy || m.status === "In-Use";
  }).length;
  const totalMachines = machineRows.length;
  const maintenanceMachines = machineRows.filter(
    m => m.status === "Maintenance" || m.status === "Offline",
  ).length;
  const utilization = totalMachines > 0 ? Math.round((inUseMachines / totalMachines) * 100) : 0;

  const lowStock = invRows.filter(i => i.stockQuantity <= i.reorderLevel).length;

  return {
    activeOrdersCount: activeOrders.length,
    totalPipelineValue: isManager(user) ? totalPipelineValue.toFixed(2) : "—",
    urgentOrdersCount: urgent,
    completedOrdersCount: completed,
    utilizationRate: utilization,
    inUseMachines,
    totalMachines,
    maintenanceMachines,
    customerCount: customerRows.length,
    inventoryAlertsCount: lowStock,
  };
}

// -------------------------------------------------------------------- INVENTORY

export async function listInventoryForUser(user: SessionUser) {
  // Inventory is shared; only Sales Coordinators are cost-restricted (unitCost hidden)
  const rows = await db.select().from(inventoryItems).orderBy(asc(inventoryItems.name));
  if (user.role === "Sales Coordinator") {
    return rows.map(i => ({ ...i, unitCost: null as unknown as string }));
  }
  return rows;
}

// -------------------------------------------------------------------- ASSETS / CMMS

export async function listAssetsForUser(user: SessionUser) {
  if (user.role === "Sales Coordinator" || user.role === "QA & Dispatch") {
    return [];
  }
  return db.select().from(assets).orderBy(asc(assets.name));
}

// -------------------------------------------------------------------- USERS

/**
 * Users are themselves sensitive - only Managers and Technicians can see
 * the full staff list. Operators see only themselves.
 */
export async function listUsersForUser(user: SessionUser) {
  if (isManager(user)) return db.select().from(users).orderBy(asc(users.name));
  if (user.role === "Technician") {
    return db.select().from(users).where(eq(users.role, "Technician")).orderBy(asc(users.name));
  }
  // Everyone else sees just themselves
  return db.select().from(users).where(eq(users.id, user.id));
}

// -------------------------------------------------------------------- QUALITY (SCRAP & REWORK)

export type ScopedQualityEvent = typeof qualityEvents.$inferSelect & {
  orderNumber: string | null;
  orderTitle: string | null;
  operationName: string | null;
  machineCode: string | null;
  machineName: string | null;
  recordedByName: string | null;
};

export async function listQualityEventsForUser(
  user: SessionUser,
  filters?: { eventType?: string; disposition?: string; machineId?: number; orderId?: number; limit?: number },
): Promise<ScopedQualityEvent[]> {
  const allowedOrderIds = await allowedOrderIdsSubquery(user);
  const ids = allowedOrderIds ? (await allowedOrderIds).map(r => r.id) : null;
  if (ids && ids.length === 0) return [];

  const whereClauses = [];
  if (ids) whereClauses.push(inArray(qualityEvents.orderId, ids));
  if (filters?.eventType && filters.eventType !== "All") whereClauses.push(eq(qualityEvents.eventType, filters.eventType));
  if (filters?.disposition && filters.disposition !== "All") whereClauses.push(eq(qualityEvents.disposition, filters.disposition));
  if (filters?.machineId) whereClauses.push(eq(qualityEvents.machineId, filters.machineId));
  if (filters?.orderId) whereClauses.push(eq(qualityEvents.orderId, filters.orderId));

  const rows = await db
    .select({
      id: qualityEvents.id,
      orderId: qualityEvents.orderId,
      operationId: qualityEvents.operationId,
      machineId: qualityEvents.machineId,
      eventType: qualityEvents.eventType,
      quantity: qualityEvents.quantity,
      unit: qualityEvents.unit,
      reason: qualityEvents.reason,
      disposition: qualityEvents.disposition,
      estimatedCost: qualityEvents.estimatedCost,
      recordedById: qualityEvents.recordedById,
      notes: qualityEvents.notes,
      createdAt: qualityEvents.createdAt,
      resolvedAt: qualityEvents.resolvedAt,
      orderNumber: orders.orderNumber,
      orderTitle: orders.title,
      operationName: orderOperations.operationName,
      machineCode: machines.code,
      machineName: machines.name,
      recordedByName: users.name,
    })
    .from(qualityEvents)
    .leftJoin(orders, eq(qualityEvents.orderId, orders.id))
    .leftJoin(orderOperations, eq(qualityEvents.operationId, orderOperations.id))
    .leftJoin(machines, eq(qualityEvents.machineId, machines.id))
    .leftJoin(users, eq(qualityEvents.recordedById, users.id))
    .where(whereClauses.length > 0 ? and(...whereClauses) : undefined)
    .orderBy(desc(qualityEvents.createdAt));

  const limited = filters?.limit ? rows.slice(0, filters.limit) : rows;
  return limited as ScopedQualityEvent[];
}

// -------------------------------------------------------------------- DOWNTIME

export type ScopedDowntimeEvent = typeof downtimeEvents.$inferSelect & {
  machineName: string | null;
  machineCode: string | null;
  orderNumber: string | null;
  operatorName: string | null;
};

export async function listDowntimeEventsForUser(
  user: SessionUser,
  filters?: { machineId?: number; activeOnly?: boolean; limit?: number },
): Promise<ScopedDowntimeEvent[]> {
  const allowedMachineIds = await allowedMachineIdsSubquery(user);
  const ids = allowedMachineIds ? (await allowedMachineIds).map(r => r.id) : null;
  if (ids && ids.length === 0) return [];

  const whereClauses = [];
  if (ids) whereClauses.push(inArray(downtimeEvents.machineId, ids));
  if (filters?.machineId) whereClauses.push(eq(downtimeEvents.machineId, filters.machineId));
  if (filters?.activeOnly) whereClauses.push(isNull(downtimeEvents.endedAt));

  const rows = await db
    .select({
      id: downtimeEvents.id,
      machineId: downtimeEvents.machineId,
      orderId: downtimeEvents.orderId,
      operationId: downtimeEvents.operationId,
      reason: downtimeEvents.reason,
      startedAt: downtimeEvents.startedAt,
      endedAt: downtimeEvents.endedAt,
      durationMinutes: downtimeEvents.durationMinutes,
      operatorId: downtimeEvents.operatorId,
      notes: downtimeEvents.notes,
      createdAt: downtimeEvents.createdAt,
      machineName: machines.name,
      machineCode: machines.code,
      orderNumber: orders.orderNumber,
      operatorName: users.name,
    })
    .from(downtimeEvents)
    .leftJoin(machines, eq(downtimeEvents.machineId, machines.id))
    .leftJoin(orders, eq(downtimeEvents.orderId, orders.id))
    .leftJoin(users, eq(downtimeEvents.operatorId, users.id))
    .where(whereClauses.length > 0 ? and(...whereClauses) : undefined)
    .orderBy(desc(downtimeEvents.startedAt));

  const limited = filters?.limit ? rows.slice(0, filters.limit) : rows;
  return limited as ScopedDowntimeEvent[];
}

// -------------------------------------------------------------------- OPERATION WRITE GUARDS

/**
 * Returns true if the user is allowed to *update the status* of this operation.
 *
 * Rules:
 *  - Manager / full operations:write holders: always allowed.
 *  - Everyone else (Operator, QA, Tech): only if the operation is theirs
 *    (operatorId = self) OR the operation is on a machine they're assigned to.
 *
 * This is used by the operations PATCH route to gate status changes
 * (Ready / In Progress / Completed / Rejected). Note: it does NOT grant
 * permission to add or delete steps - that requires operations:create or
 * operations:delete, which only Manager has.
 */
export async function canUserUpdateOperation(
  user: SessionUser,
  operationId: number,
): Promise<{ allowed: boolean; operation?: typeof orderOperations.$inferSelect; reason?: string }> {
  if (isManager(user)) {
    const [op] = await db.select().from(orderOperations).where(eq(orderOperations.id, operationId));
    if (!op) return { allowed: false, reason: "Operation not found." };
    return { allowed: true, operation: op };
  }

  const [op] = await db.select().from(orderOperations).where(eq(orderOperations.id, operationId));
  if (!op) return { allowed: false, reason: "Operation not found." };

  // The operator is the assigned operator for this step
  if (op.operatorId === user.id) return { allowed: true, operation: op };

  // Or the operator is assigned to the machine this step is on
  if (op.machineId) {
    const [machine] = await db.select().from(machines).where(eq(machines.id, op.machineId));
    if (machine && machine.assignedOperatorId === user.id) {
      return { allowed: true, operation: op };
    }
  }

  // QA can mark QA-related steps complete
  if (user.role === "QA & Dispatch") {
    // For now, QA can update any operation that lives on a machine they're
    // assigned to. If no specific assignment, fall through to deny.
    if (op.machineId) {
      const [machine] = await db.select().from(machines).where(eq(machines.id, op.machineId));
      if (machine && machine.assignedOperatorId === user.id) {
        return { allowed: true, operation: op };
      }
    }
  }

  // Technician can update operations on machines they're assigned to
  if (user.role === "Technician" && op.machineId) {
    const [machine] = await db.select().from(machines).where(eq(machines.id, op.machineId));
    if (machine && machine.assignedOperatorId === user.id) {
      return { allowed: true, operation: op };
    }
  }

  return {
    allowed: false,
    operation: op,
    reason: "You are not assigned to this operation or its machine.",
  };
}
