// Server-side HR/payroll persistence. Every caller must first enforce the
// optional payroll grant; this module only owns scoped SQL and transaction rules.
import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  hrEmployeeProfiles,
  hrLeaveRequests,
  hrPayrollItems,
  hrPayrollRuns,
  users,
} from "@/db/schema";
import {
  calculateNetPay,
  HRPayrollError,
  parseEmployeeProfile,
  parseLeaveRequest,
  parsePayrollAdjustments,
  parsePayrollPeriod,
  type LeaveStatus,
} from "@/lib/hrPayroll";
import { ensureHrSchema } from "@/lib/hrSchema.server";

function recordOf(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function positiveId(value: unknown, field: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new HRPayrollError(`${field} must be a valid number.`);
  return n;
}

function postgresCode(error: unknown, depth = 0): string {
  if (!error || typeof error !== "object" || depth > 4) return "";
  if ("code" in error && (error as { code?: unknown }).code) return String((error as { code: unknown }).code);
  return "cause" in error ? postgresCode((error as { cause?: unknown }).cause, depth + 1) : "";
}

export async function listHREmployees() {
  await ensureHrSchema();
  const rows = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    active: users.active,
    avatarColor: users.avatarColor,
    profileId: hrEmployeeProfiles.id,
    jobTitle: hrEmployeeProfiles.jobTitle,
    hireDate: hrEmployeeProfiles.hireDate,
    baseSalaryCents: hrEmployeeProfiles.baseSalaryCents,
    profileUpdatedAt: hrEmployeeProfiles.updatedAt,
  })
    .from(users)
    .leftJoin(hrEmployeeProfiles, eq(hrEmployeeProfiles.userId, users.id))
    .orderBy(desc(users.active), asc(users.name));
  return rows.map((row) => ({
    ...row,
    profileComplete: row.profileId != null,
    baseSalaryCents: row.baseSalaryCents ?? null,
  }));
}

export async function saveHREmployeeProfile(input: unknown, actorId: number) {
  const values = parseEmployeeProfile(input);
  await ensureHrSchema();
  const [employee] = await db.select({ id: users.id })
    .from(users).where(eq(users.id, values.userId)).limit(1);
  if (!employee) throw new HRPayrollError("Employee account not found.", 404);
  const [saved] = await db.insert(hrEmployeeProfiles).values({
    userId: values.userId,
    jobTitle: values.jobTitle,
    hireDate: values.hireDate,
    baseSalaryCents: values.baseSalaryCents,
    updatedById: actorId,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: hrEmployeeProfiles.userId,
    set: {
      jobTitle: values.jobTitle,
      hireDate: values.hireDate,
      baseSalaryCents: values.baseSalaryCents,
      updatedById: actorId,
      updatedAt: new Date(),
    },
  }).returning();
  return saved;
}

export async function listHRLeave() {
  await ensureHrSchema();
  const reviewer = alias(users, "hr_leave_reviewer");
  return db.select({
    id: hrLeaveRequests.id,
    userId: hrLeaveRequests.userId,
    employeeName: hrLeaveRequests.employeeName,
    employeeRole: hrLeaveRequests.roleSnapshot,
    leaveType: hrLeaveRequests.leaveType,
    startDate: hrLeaveRequests.startDate,
    endDate: hrLeaveRequests.endDate,
    days: hrLeaveRequests.days,
    reason: hrLeaveRequests.reason,
    status: hrLeaveRequests.status,
    reviewNote: hrLeaveRequests.reviewNote,
    reviewedByName: reviewer.name,
    reviewedAt: hrLeaveRequests.reviewedAt,
    createdAt: hrLeaveRequests.createdAt,
  })
    .from(hrLeaveRequests)
    .leftJoin(reviewer, eq(hrLeaveRequests.reviewedById, reviewer.id))
    .orderBy(desc(hrLeaveRequests.startDate), desc(hrLeaveRequests.id))
    .limit(1000);
}

export async function createHRLeave(input: unknown, actorId: number) {
  const values = parseLeaveRequest(input);
  await ensureHrSchema();
  return db.transaction(async (tx) => {
    // Serialize leave writes per employee so two simultaneous requests cannot
    // both pass the inclusive overlap check.
    const [employee] = await tx.select({ id: users.id, name: users.name, role: users.role, active: users.active })
      .from(users).where(eq(users.id, values.userId)).for("update");
    if (!employee) throw new HRPayrollError("Employee account not found.", 404);
    if (!employee.active) throw new HRPayrollError("Inactive employee accounts cannot receive new leave records.", 409);
    const [overlap] = await tx.select({ id: hrLeaveRequests.id })
      .from(hrLeaveRequests)
      .where(and(
        eq(hrLeaveRequests.userId, values.userId),
        inArray(hrLeaveRequests.status, ["Pending", "Approved"]),
        lte(hrLeaveRequests.startDate, values.endDate),
        gte(hrLeaveRequests.endDate, values.startDate),
      ))
      .limit(1);
    if (overlap) throw new HRPayrollError("This leave period overlaps an existing pending or approved record.", 409);
    const [created] = await tx.insert(hrLeaveRequests).values({
      ...values,
      employeeName: employee.name,
      roleSnapshot: employee.role,
      status: "Pending",
      createdById: actorId,
    }).returning();
    return created;
  });
}

export async function reviewHRLeave(input: unknown, reviewerId: number) {
  const raw = recordOf(input);
  if (!raw) throw new HRPayrollError("Choose an HR review action.");
  const id = positiveId(raw.id, "Leave record");
  const status = String(raw.status ?? "") as LeaveStatus;
  if (status !== "Approved" && status !== "Declined") throw new HRPayrollError("Leave can only be approved or declined.");
  const reviewNote = String(raw.reviewNote ?? "").trim();
  if (reviewNote.length > 500) throw new HRPayrollError("Review note must be 500 characters or fewer.");
  await ensureHrSchema();
  return db.transaction(async (tx) => {
    const [existing] = await tx.select({ userId: hrLeaveRequests.userId })
      .from(hrLeaveRequests).where(eq(hrLeaveRequests.id, id)).limit(1);
    if (!existing) throw new HRPayrollError("Leave record not found.", 404);
    // Match createHRLeave's employee → leave lock order to avoid both races and
    // deadlocks when an approval overlaps a new request. Deleted employees have
    // a null FK but retain their name/role snapshot and can still be reviewed.
    if (existing.userId != null) {
      const [employee] = await tx.select({ id: users.id })
        .from(users).where(eq(users.id, existing.userId)).for("update");
      if (!employee) throw new HRPayrollError("Employee account not found; retry this review if the account was just removed.", 404);
    }
    const [leave] = await tx.select().from(hrLeaveRequests)
      .where(eq(hrLeaveRequests.id, id)).for("update");
    if (!leave) throw new HRPayrollError("Leave record not found.", 404);
    if (leave.status !== "Pending") throw new HRPayrollError("This leave record has already been reviewed.", 409);
    if (status === "Approved" && leave.userId != null) {
      const [overlap] = await tx.select({ id: hrLeaveRequests.id })
        .from(hrLeaveRequests)
        .where(and(
          eq(hrLeaveRequests.userId, leave.userId),
          ne(hrLeaveRequests.id, id),
          inArray(hrLeaveRequests.status, ["Pending", "Approved"]),
          lte(hrLeaveRequests.startDate, leave.endDate),
          gte(hrLeaveRequests.endDate, leave.startDate),
        ))
        .limit(1);
      if (overlap) throw new HRPayrollError("Another pending or approved leave overlaps these dates.", 409);
    }
    const [updated] = await tx.update(hrLeaveRequests).set({
      status,
      reviewedById: reviewerId,
      reviewNote,
      reviewedAt: new Date(),
    }).where(eq(hrLeaveRequests.id, id)).returning();
    return updated;
  });
}

export async function getHRPayrollBoard(yearValue: unknown, monthValue: unknown) {
  const { year, month } = parsePayrollPeriod(yearValue, monthValue);
  await ensureHrSchema();
  const runs = await db.select().from(hrPayrollRuns)
    .orderBy(desc(hrPayrollRuns.periodYear), desc(hrPayrollRuns.periodMonth))
    .limit(36);
  const totals = await db.select({
    runId: hrPayrollItems.runId,
    employeeCount: sql<number>`count(*)::int`,
    netTotalCents: sql<string>`coalesce(sum(${hrPayrollItems.netPayCents}), 0)::text`,
  }).from(hrPayrollItems).groupBy(hrPayrollItems.runId);
  const totalsByRun = new Map(totals.map((row) => [row.runId, {
    employeeCount: Number(row.employeeCount) || 0,
    netTotalCents: Number(row.netTotalCents) || 0,
  }]));
  const runHistory = runs.map((run) => ({
    ...run,
    employeeCount: totalsByRun.get(run.id)?.employeeCount ?? 0,
    netTotalCents: totalsByRun.get(run.id)?.netTotalCents ?? 0,
  }));
  const [run] = await db.select().from(hrPayrollRuns)
    .where(and(eq(hrPayrollRuns.periodYear, year), eq(hrPayrollRuns.periodMonth, month)))
    .limit(1);
  if (!run) return { selectedRun: null, runs: runHistory };
  const items = await db.select().from(hrPayrollItems)
    .where(eq(hrPayrollItems.runId, run.id))
    .orderBy(asc(hrPayrollItems.employeeName), asc(hrPayrollItems.id));
  return {
    selectedRun: {
      ...run,
      employeeCount: items.length,
      netTotalCents: items.reduce((sum, item) => sum + item.netPayCents, 0),
      items,
    },
    runs: runHistory,
  };
}

export async function createHRPayrollRun(input: unknown, actorId: number) {
  const raw = recordOf(input);
  if (!raw) throw new HRPayrollError("Choose a payroll month.");
  const { year, month } = parsePayrollPeriod(raw.year, raw.month);
  await ensureHrSchema();
  try {
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: hrPayrollRuns.id })
        .from(hrPayrollRuns)
        .where(and(eq(hrPayrollRuns.periodYear, year), eq(hrPayrollRuns.periodMonth, month)))
        .limit(1);
      if (existing) throw new HRPayrollError("A payroll run already exists for this month.", 409);
      const employees = await tx.select({
        userId: users.id,
        name: users.name,
        role: users.role,
        baseSalaryCents: hrEmployeeProfiles.baseSalaryCents,
      })
        .from(hrEmployeeProfiles)
        .innerJoin(users, eq(hrEmployeeProfiles.userId, users.id))
        .where(eq(users.active, true))
        .orderBy(asc(users.name));
      if (employees.length === 0) {
        throw new HRPayrollError("Add salary profiles for active employees before generating payroll.", 409);
      }
      const [run] = await tx.insert(hrPayrollRuns).values({
        periodYear: year,
        periodMonth: month,
        status: "Draft",
        createdById: actorId,
      }).returning();
      const items = await tx.insert(hrPayrollItems).values(employees.map((employee) => ({
        runId: run.id,
        userId: employee.userId,
        employeeName: employee.name,
        roleSnapshot: employee.role,
        baseSalaryCents: employee.baseSalaryCents,
        additionsJson: [],
        deductionsJson: [],
        netPayCents: employee.baseSalaryCents,
      }))).returning();
      return { ...run, items, employeeCount: items.length, netTotalCents: items.reduce((sum, item) => sum + item.netPayCents, 0) };
    });
  } catch (error) {
    if (error instanceof HRPayrollError) throw error;
    if (postgresCode(error) === "23505") throw new HRPayrollError("A payroll run already exists for this month.", 409);
    throw error;
  }
}

export async function updateHRPayrollItem(input: unknown) {
  const raw = recordOf(input);
  if (!raw) throw new HRPayrollError("Enter payroll adjustment details.");
  const runId = positiveId(raw.runId, "Payroll run");
  const itemId = positiveId(raw.itemId, "Payslip");
  const adjustments = parsePayrollAdjustments({ additions: raw.additions, deductions: raw.deductions });
  await ensureHrSchema();
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(hrPayrollRuns)
      .where(eq(hrPayrollRuns.id, runId)).for("update");
    if (!run) throw new HRPayrollError("Payroll run not found.", 404);
    if (run.status !== "Draft") throw new HRPayrollError("Posted payroll is locked; start a correction in a new run.", 409);
    const [item] = await tx.select().from(hrPayrollItems)
      .where(and(eq(hrPayrollItems.id, itemId), eq(hrPayrollItems.runId, runId))).for("update");
    if (!item) throw new HRPayrollError("Payslip does not belong to this payroll run.", 404);
    const netPayCents = calculateNetPay(item.baseSalaryCents, adjustments);
    const [updated] = await tx.update(hrPayrollItems).set({
      additionsJson: adjustments.additions,
      deductionsJson: adjustments.deductions,
      netPayCents,
    }).where(eq(hrPayrollItems.id, item.id)).returning();
    return updated;
  });
}

export async function postHRPayrollRun(runValue: unknown, actorId: number) {
  const runId = positiveId(runValue, "Payroll run");
  await ensureHrSchema();
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(hrPayrollRuns)
      .where(eq(hrPayrollRuns.id, runId)).for("update");
    if (!run) throw new HRPayrollError("Payroll run not found.", 404);
    if (run.status !== "Draft") throw new HRPayrollError("This payroll run has already been posted.", 409);
    const [firstItem] = await tx.select({ id: hrPayrollItems.id })
      .from(hrPayrollItems).where(eq(hrPayrollItems.runId, runId)).limit(1);
    if (!firstItem) throw new HRPayrollError("An empty payroll run cannot be posted.", 409);
    const [updated] = await tx.update(hrPayrollRuns).set({
      status: "Posted",
      postedById: actorId,
      postedAt: new Date(),
    }).where(eq(hrPayrollRuns.id, runId)).returning();
    return updated;
  });
}

export async function deleteHRPayrollRun(runValue: unknown) {
  const runId = positiveId(runValue, "Payroll run");
  await ensureHrSchema();
  return db.transaction(async (tx) => {
    const [run] = await tx.select().from(hrPayrollRuns)
      .where(eq(hrPayrollRuns.id, runId)).for("update");
    if (!run) throw new HRPayrollError("Payroll run not found.", 404);
    if (run.status !== "Draft") throw new HRPayrollError("Posted payroll is a permanent record and cannot be deleted.", 409);
    await tx.delete(hrPayrollRuns).where(eq(hrPayrollRuns.id, runId));
    return { id: runId };
  });
}
