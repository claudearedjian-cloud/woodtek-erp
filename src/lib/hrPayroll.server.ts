// Server-side HR/payroll persistence. Every caller must first enforce the
// optional payroll grant; this module only owns scoped SQL and transaction rules.
import { randomBytes } from "node:crypto";
import { alias } from "drizzle-orm/pg-core";
import { and, asc, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  hrEmployeeDocuments,
  hrEmployeeProfiles,
  hrLeaveRequests,
  hrPayrollItems,
  hrPayrollRuns,
  hrSalaryHistory,
  orderOperations,
  users,
} from "@/db/schema";
import {
  calculateNetPay,
  HRPayrollError,
  NO_LOGIN_EMAIL_DOMAIN,
  overtimePayrollLine,
  parseEmployeeProfile,
  parseLeaveRequest,
  parseNoLoginIdentity,
  parsePayrollAdjustments,
  parsePayrollPeriod,
  parseSalaryHistoryEntry,
  payrollPeriodLabel,
  type LeaveStatus,
} from "@/lib/hrPayroll";
import { approvedOvertimeForPeriod, linkOvertimeToRun, unlinkOvertimeFromRun } from "@/lib/hrOvertime.server";
import { ensureHrSchema } from "@/lib/hrSchema.server";
import { hashPin } from "@/lib/auth";
import { allRoles, baseRoleOf } from "@/lib/permissions";
import { ensureRolesRegistered } from "@/lib/rolesConfig.server";

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
    canLogin: users.canLogin,
    avatarColor: users.avatarColor,
    profileId: hrEmployeeProfiles.id,
    jobTitle: hrEmployeeProfiles.jobTitle,
    hireDate: hrEmployeeProfiles.hireDate,
    baseSalaryCents: hrEmployeeProfiles.baseSalaryCents,
    employeeCode: hrEmployeeProfiles.employeeCode,
    department: hrEmployeeProfiles.department,
    employmentStatus: hrEmployeeProfiles.employmentStatus,
    nationality: hrEmployeeProfiles.nationality,
    dateOfBirth: hrEmployeeProfiles.dateOfBirth,
    gender: hrEmployeeProfiles.gender,
    maritalStatus: hrEmployeeProfiles.maritalStatus,
    phone: hrEmployeeProfiles.phone,
    address: hrEmployeeProfiles.address,
    idNumber: hrEmployeeProfiles.idNumber,
    passportNumber: hrEmployeeProfiles.passportNumber,
    visaNumber: hrEmployeeProfiles.visaNumber,
    residencyNumber: hrEmployeeProfiles.residencyNumber,
    residencyExpiry: hrEmployeeProfiles.residencyExpiry,
    emergencyContactName: hrEmployeeProfiles.emergencyContactName,
    emergencyContactPhone: hrEmployeeProfiles.emergencyContactPhone,
    bloodType: hrEmployeeProfiles.bloodType,
    religion: hrEmployeeProfiles.religion,
    socialSecurityNumber: hrEmployeeProfiles.socialSecurityNumber,
    bankName: hrEmployeeProfiles.bankName,
    iban: hrEmployeeProfiles.iban,
    notes: hrEmployeeProfiles.notes,
    photoFile: hrEmployeeProfiles.photoFile,
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
  // Previous salary, read before the upsert: a change appends a salary-history
  // entry automatically (below), an untouched amount appends nothing.
  const [previous] = await db.select({ baseSalaryCents: hrEmployeeProfiles.baseSalaryCents })
    .from(hrEmployeeProfiles).where(eq(hrEmployeeProfiles.userId, values.userId)).limit(1);
  const profileValues = {
    userId: values.userId,
    jobTitle: values.jobTitle,
    hireDate: values.hireDate,
    baseSalaryCents: values.baseSalaryCents,
    employeeCode: values.employeeCode,
    department: values.department,
    employmentStatus: values.employmentStatus || "Active",
    nationality: values.nationality,
    dateOfBirth: values.dateOfBirth,
    gender: values.gender,
    maritalStatus: values.maritalStatus,
    phone: values.phone,
    address: values.address,
    idNumber: values.idNumber,
    passportNumber: values.passportNumber,
    visaNumber: values.visaNumber,
    residencyNumber: values.residencyNumber,
    residencyExpiry: values.residencyExpiry,
    emergencyContactName: values.emergencyContactName,
    emergencyContactPhone: values.emergencyContactPhone,
    bloodType: values.bloodType,
    religion: values.religion,
    socialSecurityNumber: values.socialSecurityNumber,
    bankName: values.bankName,
    iban: values.iban,
    notes: values.notes,
    updatedById: actorId,
    updatedAt: new Date(),
  };
  const [saved] = await db.insert(hrEmployeeProfiles).values(profileValues).onConflictDoUpdate({
    target: hrEmployeeProfiles.userId,
    set: {
      jobTitle: profileValues.jobTitle,
      hireDate: profileValues.hireDate,
      baseSalaryCents: profileValues.baseSalaryCents,
      employeeCode: profileValues.employeeCode,
      department: profileValues.department,
      employmentStatus: profileValues.employmentStatus,
      nationality: profileValues.nationality,
      dateOfBirth: profileValues.dateOfBirth,
      gender: profileValues.gender,
      maritalStatus: profileValues.maritalStatus,
      phone: profileValues.phone,
      address: profileValues.address,
      idNumber: profileValues.idNumber,
      passportNumber: profileValues.passportNumber,
      visaNumber: profileValues.visaNumber,
      residencyNumber: profileValues.residencyNumber,
      residencyExpiry: profileValues.residencyExpiry,
      emergencyContactName: profileValues.emergencyContactName,
      emergencyContactPhone: profileValues.emergencyContactPhone,
      bloodType: profileValues.bloodType,
      religion: profileValues.religion,
      socialSecurityNumber: profileValues.socialSecurityNumber,
      bankName: profileValues.bankName,
      iban: profileValues.iban,
      notes: profileValues.notes,
      updatedById: actorId,
      updatedAt: new Date(),
    },
  }).returning();
  // Every base-salary change appends a dated history entry automatically, so
  // the timeline stays complete even when HR only edits the card amount. A
  // brand-new card seeds its starting salary (hire date when known, skipped
  // when the starting salary is $0); later changes take effect today.
  const salaryChanged = previous
    ? previous.baseSalaryCents !== values.baseSalaryCents
    : values.baseSalaryCents > 0;
  if (salaryChanged) {
    await db.insert(hrSalaryHistory).values({
      userId: values.userId,
      effectiveDate: previous ? new Date().toISOString().slice(0, 10) : (values.hireDate ?? new Date().toISOString().slice(0, 10)),
      monthlyAmountCents: values.baseSalaryCents,
      note: previous ? "Updated on the employee card" : "Starting salary",
      createdById: actorId,
    });
  }
  return saved;
}

// ------------------------------------------------------- salary history
//
// Ledger of base-salary changes per employee. Entries are recorded
// automatically by saveHREmployeeProfile; older changes can also be backfilled
// by hand. The profile's base salary stays the single value payroll drafts
// snapshot — this table never feeds payroll directly.

export async function listSalaryHistory(userValue: unknown) {
  const userId = positiveId(userValue, "Employee");
  await ensureHrSchema();
  await checkedEmployee(userId);
  return db.select({
    id: hrSalaryHistory.id,
    userId: hrSalaryHistory.userId,
    effectiveDate: hrSalaryHistory.effectiveDate,
    monthlyAmountCents: hrSalaryHistory.monthlyAmountCents,
    note: hrSalaryHistory.note,
    createdAt: hrSalaryHistory.createdAt,
  })
    .from(hrSalaryHistory)
    .where(eq(hrSalaryHistory.userId, userId))
    .orderBy(desc(hrSalaryHistory.effectiveDate), desc(hrSalaryHistory.id));
}

export async function addSalaryHistoryEntry(input: unknown, actorId: number) {
  const values = parseSalaryHistoryEntry(input);
  await ensureHrSchema();
  await checkedEmployee(values.userId);
  const [row] = await db.insert(hrSalaryHistory).values({
    ...values,
    createdById: actorId,
  }).returning({
    id: hrSalaryHistory.id,
    userId: hrSalaryHistory.userId,
    effectiveDate: hrSalaryHistory.effectiveDate,
    monthlyAmountCents: hrSalaryHistory.monthlyAmountCents,
    note: hrSalaryHistory.note,
    createdAt: hrSalaryHistory.createdAt,
  });
  return row;
}

export async function deleteSalaryHistoryEntry(entryValue: unknown) {
  const id = positiveId(entryValue, "Salary entry");
  await ensureHrSchema();
  const [row] = await db.select({
    id: hrSalaryHistory.id,
    userId: hrSalaryHistory.userId,
    effectiveDate: hrSalaryHistory.effectiveDate,
    monthlyAmountCents: hrSalaryHistory.monthlyAmountCents,
  }).from(hrSalaryHistory).where(eq(hrSalaryHistory.id, id)).limit(1);
  if (!row) throw new HRPayrollError("Salary entry not found.", 404);
  await db.delete(hrSalaryHistory).where(eq(hrSalaryHistory.id, id));
  return row;
}

// ------------------------------------------- HR-only (no-login) employees
//
// Staff without a sign-in (Worker, Cleaner, …) live in the same users table
// so the employee card, leave and payroll keep working untouched. The
// can_login flag is the only difference: the roster hides them,
// getSessionUser rejects them and the login POST never resolves them.

async function checkedEmployee(userId: number) {
  const [employee] = await db.select({
    id: users.id,
    name: users.name,
    email: users.email,
    role: users.role,
    active: users.active,
    canLogin: users.canLogin,
  }).from(users).where(eq(users.id, userId)).limit(1);
  if (!employee) throw new HRPayrollError("Employee account not found.", 404);
  return employee;
}

/** True when another active login Manager exists besides `excludeId`. */
async function anotherLoginManagerExists(excludeId: number): Promise<boolean> {
  ensureRolesRegistered();
  const rows = await db.select({ id: users.id, role: users.role })
    .from(users)
    .where(and(eq(users.active, true), eq(users.canLogin, true)));
  return rows.some((row) => row.id !== excludeId && (baseRoleOf(row.role) || row.role) === "Manager");
}

async function guardAccountStillManaged(targetUserId: number): Promise<void> {
  const target = await checkedEmployee(targetUserId);
  ensureRolesRegistered();
  const targetIsManager = (baseRoleOf(target.role) || target.role) === "Manager";
  if (target.active && target.canLogin && targetIsManager && !(await anotherLoginManagerExists(targetUserId))) {
    throw new HRPayrollError("This is the last active Manager sign-in; it cannot be switched off.", 409);
  }
}

function uniqueNoLoginEmail(): string {
  return `hr-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}@${NO_LOGIN_EMAIL_DOMAIN}`;
}

/**
 * Creates an HR-only employee (no sign-in) with its card shell. The stored
 * users.role is the inert job-description text until a Manager enables a
 * login with a real system role. Callers must enforce the payroll grant.
 */
export async function createNoLoginEmployee(input: unknown, actorId: number) {
  const raw = recordOf(input);
  if (!raw) throw new HRPayrollError("Enter the employee's name.");
  const identity = parseNoLoginIdentity(raw);
  // Validate every card field BEFORE inserting, so a bad date never leaves
  // a half-created employee behind.
  parseEmployeeProfile({ ...(raw as Record<string, unknown>), userId: 1 });
  await ensureHrSchema();

  const jobTitle = String(raw.jobTitle ?? "").trim().replace(/\s+/g, " ").slice(0, 80) || "Worker";
  let email = identity.email;
  if (!email) {
    email = uniqueNoLoginEmail();
    for (let attempt = 0; attempt < 5; attempt++) {
      const [clash] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (!clash) break;
      email = uniqueNoLoginEmail();
    }
  }
  try {
    const [created] = await db.insert(users).values({
      name: identity.name,
      email,
      role: jobTitle,
      avatarColor: "bg-slate-600",
      pin: await hashPin(randomBytes(16).toString("hex")),
      active: true,
      canLogin: false,
      phone: String(raw.phone ?? "").trim().slice(0, 30) || null,
      notes: null,
    }).returning({ id: users.id, name: users.name, email: users.email, role: users.role });
    await saveHREmployeeProfile({ ...(raw as Record<string, unknown>), userId: created.id }, actorId);
    return created;
  } catch (error) {
    if (error instanceof HRPayrollError) throw error;
    if (postgresCode(error) === "23505") {
      throw new HRPayrollError("This e-mail address is already used by another employee.", 409);
    }
    throw error;
  }
}

export interface EmployeeLoginInput {
  userId: number;
  enable: boolean;
  role?: unknown;
  pin?: unknown;
}

/**
 * Enables or disables an employee's sign-in. Enabling requires a real
 * system role and a fresh 4-digit PIN. Callers must enforce users:manage —
 * only a Manager hands out or revokes access.
 */
export async function setEmployeeLogin(input: unknown, actorId: number) {
  const raw = recordOf(input);
  if (!raw) throw new HRPayrollError("Choose an employee.");
  const userId = positiveId(raw.userId, "Employee");
  const enable = raw.enable === true;
  await ensureHrSchema();
  const target = await checkedEmployee(userId);

  if (enable) {
    ensureRolesRegistered();
    const role = String(raw.role ?? "").trim();
    if (!allRoles().includes(role)) {
      throw new HRPayrollError(`Unknown role "${role || "—"}". Pick a system role for the new login.`);
    }
    const pin = String(raw.pin ?? "").trim();
    if (!/^\d{4}$/.test(pin)) throw new HRPayrollError("A four-digit PIN is required to enable the login.");
    const [updated] = await db.update(users).set({
      role,
      pin: await hashPin(pin),
      canLogin: true,
    }).where(eq(users.id, userId)).returning({
      id: users.id, name: users.name, role: users.role, canLogin: users.canLogin,
    });
    return updated;
  }

  if (userId === actorId) throw new HRPayrollError("You cannot disable your own sign-in.", 403);
  await guardAccountStillManaged(userId);
  const [updated] = await db.update(users).set({ canLogin: false })
    .where(eq(users.id, userId)).returning({
      id: users.id, name: users.name, role: users.role, canLogin: users.canLogin,
    });
  void target;
  return updated;
}

/**
 * Activates or deactivates an employee account. Inactive staff leave the
 * sign-in roster and stop entering new payroll drafts; their card, leave
 * history and posted payslips stay untouched. Callers enforce payroll grant.
 */
export async function setEmployeeActive(input: unknown, actorId: number) {
  const raw = recordOf(input);
  if (!raw) throw new HRPayrollError("Choose an employee.");
  const userId = positiveId(raw.userId, "Employee");
  const active = raw.active === true;
  await ensureHrSchema();
  await checkedEmployee(userId);
  if (!active) {
    if (userId === actorId) throw new HRPayrollError("You cannot deactivate your own account.", 403);
    await guardAccountStillManaged(userId);
  }
  const [updated] = await db.update(users).set({ active })
    .where(eq(users.id, userId)).returning({
      id: users.id, name: users.name, active: users.active, canLogin: users.canLogin,
    });
  return updated;
}

/**
 * Deletes an HR-only employee record. Login users are refused here — their
 * deletion stays a Manager action in Settings. Cascades the card and its
 * attachments; leave and payroll history keep their snapshots. Callers
 * enforce the payroll grant.
 */
export async function deleteNoLoginEmployee(userValue: unknown, actorId: number) {
  const userId = positiveId(userValue, "Employee");
  await ensureHrSchema();
  const target = await checkedEmployee(userId);
  if (userId === actorId) throw new HRPayrollError("You cannot delete your own account.", 403);
  if (target.canLogin) {
    throw new HRPayrollError("This employee has a login — delete the account in Settings instead.", 409);
  }
  const assigned = await db.select({ id: orderOperations.id })
    .from(orderOperations).where(eq(orderOperations.operatorId, userId)).limit(1);
  if (assigned.length > 0) {
    throw new HRPayrollError("Cannot delete an employee with assigned operations. Deactivate instead.", 409);
  }
  await db.delete(users).where(eq(users.id, userId));
  // Orphaned photo/document files (if any) are ignored by every reader, the
  // same as other file-backed stores — metadata deletion is authoritative.
  return { id: userId, name: target.name };
}

// ------------------------------------------------- employee card attachments

export interface EmployeeDocumentInput {
  userId: number;
  docType: string;
  title: string;
  fileName: string;
  originalName: string;
  mime: string;
  size: number;
  expiryDate: string | null;
}

export async function listEmployeeDocuments(userId: number) {
  await ensureHrSchema();
  return db.select({
    id: hrEmployeeDocuments.id,
    userId: hrEmployeeDocuments.userId,
    docType: hrEmployeeDocuments.docType,
    title: hrEmployeeDocuments.title,
    fileName: hrEmployeeDocuments.fileName,
    originalName: hrEmployeeDocuments.originalName,
    mime: hrEmployeeDocuments.mime,
    size: hrEmployeeDocuments.size,
    expiryDate: hrEmployeeDocuments.expiryDate,
    createdAt: hrEmployeeDocuments.createdAt,
  })
    .from(hrEmployeeDocuments)
    .where(eq(hrEmployeeDocuments.userId, userId))
    .orderBy(desc(hrEmployeeDocuments.createdAt), desc(hrEmployeeDocuments.id));
}

export async function countEmployeeDocuments(userId: number): Promise<number> {
  await ensureHrSchema();
  const [row] = await db.select({ n: sql<number>`count(*)::int` })
    .from(hrEmployeeDocuments)
    .where(eq(hrEmployeeDocuments.userId, userId));
  return Number(row?.n ?? 0);
}

export async function createEmployeeDocument(input: EmployeeDocumentInput, actorId: number) {
  await ensureHrSchema();
  const [employee] = await db.select({ id: users.id })
    .from(users).where(eq(users.id, input.userId)).limit(1);
  if (!employee) throw new HRPayrollError("Employee account not found.", 404);
  const [created] = await db.insert(hrEmployeeDocuments).values({
    userId: input.userId,
    docType: input.docType,
    title: input.title,
    fileName: input.fileName,
    originalName: input.originalName,
    mime: input.mime,
    size: input.size,
    expiryDate: input.expiryDate,
    uploadedById: actorId,
  }).returning();
  return created;
}

export async function getEmployeeDocument(id: number) {
  await ensureHrSchema();
  const [row] = await db.select().from(hrEmployeeDocuments)
    .where(eq(hrEmployeeDocuments.id, id)).limit(1);
  return row ?? null;
}

export async function deleteEmployeeDocument(id: number) {
  await ensureHrSchema();
  const [removed] = await db.delete(hrEmployeeDocuments)
    .where(eq(hrEmployeeDocuments.id, id)).returning();
  return removed ?? null;
}

/** Personal photo file name stored on the profile ("" = none). */
export async function getEmployeePhotoFile(userId: number): Promise<string> {
  await ensureHrSchema();
  const [row] = await db.select({ photoFile: hrEmployeeProfiles.photoFile })
    .from(hrEmployeeProfiles).where(eq(hrEmployeeProfiles.userId, userId)).limit(1);
  return row?.photoFile ?? "";
}

/**
 * Points the profile at a new personal photo, creating the shell profile row
 * when HR has not filled the card yet (photo first, pay details later).
 */
export async function setEmployeePhotoFile(userId: number, fileName: string, actorId: number) {
  await ensureHrSchema();
  const [employee] = await db.select({ id: users.id })
    .from(users).where(eq(users.id, userId)).limit(1);
  if (!employee) throw new HRPayrollError("Employee account not found.", 404);
  const [saved] = await db.insert(hrEmployeeProfiles).values({
    userId,
    jobTitle: "",
    hireDate: null,
    baseSalaryCents: 0,
    photoFile: fileName,
    updatedById: actorId,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: hrEmployeeProfiles.userId,
    set: { photoFile: fileName, updatedById: actorId, updatedAt: new Date() },
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
      // Approved overtime of this month that no run has paid yet becomes one
      // labelled earnings line per employee; the entries are linked to this run
      // inside the same transaction so a rolled-back draft pays nothing twice.
      const overtime = await approvedOvertimeForPeriod(year, month, tx);
      const overtimeByEmployee = new Map(overtime.map((entry) => [entry.userId, entry]));
      const [run] = await tx.insert(hrPayrollRuns).values({
        periodYear: year,
        periodMonth: month,
        status: "Draft",
        createdById: actorId,
      }).returning();
      const linkedEntryIds: number[] = [];
      const items = await tx.insert(hrPayrollItems).values(employees.map((employee) => {
        const ot = overtimeByEmployee.get(employee.userId);
        const line = ot ? overtimePayrollLine(ot.minutes, ot.amountCents, payrollPeriodLabel(year, month)) : null;
        const additions = line ? [line] : [];
        if (ot && line) linkedEntryIds.push(...ot.entryIds);
        return {
          runId: run.id,
          userId: employee.userId,
          employeeName: employee.name,
          roleSnapshot: employee.role,
          baseSalaryCents: employee.baseSalaryCents,
          additionsJson: additions,
          deductionsJson: [],
          netPayCents: calculateNetPay(employee.baseSalaryCents, { additions, deductions: [] }),
        };
      })).returning();
      await linkOvertimeToRun(linkedEntryIds, run.id, tx);
      return {
        ...run,
        items,
        employeeCount: items.length,
        netTotalCents: items.reduce((sum, item) => sum + item.netPayCents, 0),
        overtimeEntriesPaid: linkedEntryIds.length,
        overtimeMinutesPaid: overtime.reduce((sum, entry) => sum + entry.minutes, 0),
      };
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
    // Put the overtime this draft had taken back in the unpaid pool, so the next
    // draft for the month pays those hours instead of silently dropping them.
    // (The foreign key would null them anyway; doing it here keeps the intent in
    // the transaction and the returned count in the audit trail.)
    const freedOvertime = await unlinkOvertimeFromRun(runId, tx);
    await tx.delete(hrPayrollRuns).where(eq(hrPayrollRuns.id, runId));
    return { id: runId, overtimeEntriesFreed: freedOvertime };
  });
}
