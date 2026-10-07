// ============================================================================
// Overtime register — SERVER ONLY (node imports).
//
// One row per employee per extra-hours stint. The day kind (Working / Holiday /
// Day off), the rate per hour and the amount in cents are SNAPSHOTS resolved
// from the working calendar at save time, so a later change to the calendar,
// the multipliers or the salary never rewrites recorded overtime.
//
// Rules
// - the rate per hour is either typed by HR or derived: company default rate,
//   else monthly salary ÷ that month's standard hours, times the day-kind
//   multiplier (150 % weekday, 200 % holiday by default);
// - a day already covered by approved leave refuses overtime (nobody works
//   while on leave) as long as the working-calendar leave rule is on;
// - the per-day overtime cap from the working calendar is enforced across all
//   of that employee's entries for the day;
// - only Approved entries feed a payroll draft, and once a draft has taken them
//   they are locked (delete the draft to change them) so a payslip and the
//   register can never disagree.
// ============================================================================

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { hrEmployeeProfiles, hrOvertimeEntries, hrPayrollRuns, users } from "@/db/schema";
import {
  dayKind,
  derivedHourlyRateCents,
  formatMinutes,
  overtimeAmountCents,
  overtimeMultiplierPercent,
  overtimeRateCentsPerHour,
  ymdLabel,
  type DayKind,
  type HrCalendarConfig,
} from "@/lib/hrCalendar";
import { readHrCalendar } from "@/lib/hrCalendar.server";
import {
  HRPayrollError,
  MAX_HOURLY_RATE_CENTS,
  parseOvertimeEntry,
  payrollPeriodLabel,
  type OvertimeEntryInput,
  type OvertimeStatus,
} from "@/lib/hrPayroll";
import { ensureHrSchema } from "@/lib/hrSchema.server";
import { workLeaveBlock } from "@/lib/hrLeaveGate.server";

/** Transaction or the plain pool — payroll drafts link overtime inside their tx. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Tx | typeof db;

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

function monthOf(workDate: string): { year: number; month: number } {
  return { year: Number(workDate.slice(0, 4)), month: Number(workDate.slice(5, 7)) };
}

export interface OvertimeRow {
  id: number;
  userId: number;
  employeeName: string;
  workDate: string;
  dayKind: string;
  startTime: string;
  endTime: string;
  minutes: number;
  baseRateCentsPerHour: number;
  multiplierPercent: number;
  rateCentsPerHour: number;
  amountCents: number;
  status: OvertimeStatus;
  notes: string;
  payrollRunId: number | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

const OVERTIME_COLUMNS = {
  id: hrOvertimeEntries.id,
  userId: hrOvertimeEntries.userId,
  employeeName: hrOvertimeEntries.employeeName,
  workDate: hrOvertimeEntries.workDate,
  dayKind: hrOvertimeEntries.dayKind,
  startTime: hrOvertimeEntries.startTime,
  endTime: hrOvertimeEntries.endTime,
  minutes: hrOvertimeEntries.minutes,
  baseRateCentsPerHour: hrOvertimeEntries.baseRateCentsPerHour,
  multiplierPercent: hrOvertimeEntries.multiplierPercent,
  rateCentsPerHour: hrOvertimeEntries.rateCentsPerHour,
  amountCents: hrOvertimeEntries.amountCents,
  status: hrOvertimeEntries.status,
  notes: hrOvertimeEntries.notes,
  payrollRunId: hrOvertimeEntries.payrollRunId,
  reviewedAt: hrOvertimeEntries.reviewedAt,
  createdAt: hrOvertimeEntries.createdAt,
};

/**
 * Register view. Filters are all optional: `year`+`month` (period), `userId`,
 * `status`, and `unpaidOnly` (approved entries no payroll draft has taken yet).
 */
export async function listHROvertime(params: {
  year?: number;
  month?: number;
  userId?: number;
  status?: string;
  unpaidOnly?: boolean;
  limit?: number;
} = {}): Promise<OvertimeRow[]> {
  await ensureHrSchema();
  const conditions = [];
  if (Number.isInteger(params.year) && Number.isInteger(params.month)) {
    const from = `${params.year}-${String(params.month).padStart(2, "0")}-01`;
    const to = `${params.year}-${String(params.month).padStart(2, "0")}-31`;
    conditions.push(sql`${hrOvertimeEntries.workDate} >= ${from}`);
    conditions.push(sql`${hrOvertimeEntries.workDate} <= ${to}`);
  }
  if (Number.isInteger(params.userId) && Number(params.userId) > 0) {
    conditions.push(eq(hrOvertimeEntries.userId, Number(params.userId)));
  }
  if (params.status && ["Pending", "Approved", "Rejected"].includes(params.status)) {
    conditions.push(eq(hrOvertimeEntries.status, params.status));
  }
  if (params.unpaidOnly) {
    conditions.push(eq(hrOvertimeEntries.status, "Approved"));
    conditions.push(isNull(hrOvertimeEntries.payrollRunId));
  }
  const rows = await db.select(OVERTIME_COLUMNS)
    .from(hrOvertimeEntries)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(hrOvertimeEntries.workDate), asc(hrOvertimeEntries.employeeName), desc(hrOvertimeEntries.id))
    .limit(Math.min(Math.max(Number(params.limit) || 500, 1), 2000));
  return rows as OvertimeRow[];
}

/** Live suggestion for the overtime form: day kind, base rate, rate and amount. */
export async function suggestOvertimeRate(input: unknown): Promise<{
  workDate: string;
  dayKind: DayKind;
  baseRateCentsPerHour: number;
  multiplierPercent: number;
  rateCentsPerHour: number;
  minutes: number;
  amountCents: number;
  source: "company-rate" | "salary" | "none";
}> {
  const values = parseOvertimeEntry(input);
  await ensureHrSchema();
  const calendar = readHrCalendar();
  const [profile] = await db.select({ baseSalaryCents: hrEmployeeProfiles.baseSalaryCents })
    .from(hrEmployeeProfiles).where(eq(hrEmployeeProfiles.userId, values.userId)).limit(1);
  const { year, month } = monthOf(values.workDate);
  const kind = dayKind(values.workDate, calendar);
  const salaryRate = derivedHourlyRateCents(profile?.baseSalaryCents ?? 0, year, month, calendar);
  const source = calendar.overtime.defaultRateCentsPerHour > 0
    ? "company-rate"
    : salaryRate > 0 ? "salary" : "none";
  const baseRateCentsPerHour = calendar.overtime.defaultRateCentsPerHour > 0
    ? calendar.overtime.defaultRateCentsPerHour
    : salaryRate;
  const multiplierPercent = overtimeMultiplierPercent(kind, calendar.overtime);
  const suggested = overtimeRateCentsPerHour(kind, baseRateCentsPerHour, calendar.overtime);
  const rateCentsPerHour = values.rateCentsPerHour > 0 ? values.rateCentsPerHour : suggested;
  return {
    workDate: values.workDate,
    dayKind: kind,
    baseRateCentsPerHour,
    multiplierPercent,
    rateCentsPerHour,
    minutes: values.minutes,
    amountCents: overtimeAmountCents(values.minutes, rateCentsPerHour),
    source,
  };
}

interface ResolvedOvertime {
  kind: DayKind;
  baseRateCentsPerHour: number;
  multiplierPercent: number;
  rateCentsPerHour: number;
  amountCents: number;
}

function resolveOvertime(
  values: OvertimeEntryInput,
  calendar: HrCalendarConfig,
  baseSalaryCents: number,
): ResolvedOvertime {
  const { year, month } = monthOf(values.workDate);
  const kind = dayKind(values.workDate, calendar);
  const multiplierPercent = overtimeMultiplierPercent(kind, calendar.overtime);
  const baseRateCentsPerHour = calendar.overtime.defaultRateCentsPerHour > 0
    ? calendar.overtime.defaultRateCentsPerHour
    : derivedHourlyRateCents(baseSalaryCents, year, month, calendar);
  const suggested = overtimeRateCentsPerHour(kind, baseRateCentsPerHour, calendar.overtime);
  const rateCentsPerHour = values.rateCentsPerHour > 0
    ? Math.min(values.rateCentsPerHour, MAX_HOURLY_RATE_CENTS)
    : suggested;
  if (rateCentsPerHour <= 0) {
    throw new HRPayrollError(
      "No overtime rate could be worked out: type a rate per hour, or save a monthly salary on the employee card, or set a company overtime rate in HR → Working calendar.",
      409,
    );
  }
  return {
    kind,
    baseRateCentsPerHour,
    multiplierPercent,
    rateCentsPerHour,
    amountCents: overtimeAmountCents(values.minutes, rateCentsPerHour),
  };
}

async function assertDailyCap(
  userId: number,
  workDate: string,
  minutes: number,
  calendar: HrCalendarConfig,
  excludeId?: number,
): Promise<void> {
  const cap = calendar.overtime.maxMinutesPerDay;
  if (cap <= 0) return;
  const conditions = [
    eq(hrOvertimeEntries.userId, userId),
    eq(hrOvertimeEntries.workDate, workDate),
    inArray(hrOvertimeEntries.status, ["Pending", "Approved"]),
  ];
  if (excludeId) conditions.push(sql`${hrOvertimeEntries.id} <> ${excludeId}`);
  const rows = await db.select({ minutes: hrOvertimeEntries.minutes })
    .from(hrOvertimeEntries).where(and(...conditions));
  const already = rows.reduce((sum, row) => sum + Number(row.minutes || 0), 0);
  if (already + minutes > cap) {
    throw new HRPayrollError(
      `That would exceed the daily overtime cap of ${formatMinutes(cap)} (${ymdLabel(workDate)} already holds ${formatMinutes(already)}). Raise the cap in HR → Working calendar if this is correct.`,
      409,
    );
  }
}

/** Records one overtime stint for an employee. */
export async function createHROvertime(input: unknown, actorId: number): Promise<OvertimeRow> {
  const values = parseOvertimeEntry(input);
  await ensureHrSchema();
  const calendar = readHrCalendar();
  const [employee] = await db.select({ id: users.id, name: users.name, active: users.active })
    .from(users).where(eq(users.id, values.userId)).limit(1);
  if (!employee) throw new HRPayrollError("Employee account not found.", 404);
  if (!employee.active) throw new HRPayrollError("Inactive employee accounts cannot receive overtime.", 409);
  // Nobody works while on approved leave — refuse the same way an assignment is
  // refused, with the same sentence.
  const onLeave = await workLeaveBlock(values.userId, values.workDate, "assign");
  if (onLeave) throw new HRPayrollError(onLeave.message, 409);
  const [profile] = await db.select({ baseSalaryCents: hrEmployeeProfiles.baseSalaryCents })
    .from(hrEmployeeProfiles).where(eq(hrEmployeeProfiles.userId, values.userId)).limit(1);
  const resolved = resolveOvertime(values, calendar, profile?.baseSalaryCents ?? 0);
  await assertDailyCap(values.userId, values.workDate, values.minutes, calendar);
  // A double-clicked Save must not create two identical rows.
  const [duplicate] = await db.select({ id: hrOvertimeEntries.id })
    .from(hrOvertimeEntries)
    .where(and(
      eq(hrOvertimeEntries.userId, values.userId),
      eq(hrOvertimeEntries.workDate, values.workDate),
      eq(hrOvertimeEntries.minutes, values.minutes),
      eq(hrOvertimeEntries.startTime, values.startTime),
      eq(hrOvertimeEntries.endTime, values.endTime),
      inArray(hrOvertimeEntries.status, ["Pending", "Approved"]),
    ))
    .limit(1);
  if (duplicate) {
    throw new HRPayrollError("This overtime is already recorded for that employee on that day.", 409);
  }
  const [created] = await db.insert(hrOvertimeEntries).values({
    userId: values.userId,
    employeeName: employee.name,
    workDate: values.workDate,
    dayKind: resolved.kind,
    startTime: values.startTime,
    endTime: values.endTime,
    minutes: values.minutes,
    baseRateCentsPerHour: resolved.baseRateCentsPerHour,
    multiplierPercent: resolved.multiplierPercent,
    rateCentsPerHour: resolved.rateCentsPerHour,
    amountCents: resolved.amountCents,
    status: calendar.overtime.approvalRequired ? "Pending" : "Approved",
    notes: values.notes,
    createdById: actorId,
    reviewedById: calendar.overtime.approvalRequired ? null : actorId,
    reviewedAt: calendar.overtime.approvalRequired ? null : new Date(),
  }).returning(OVERTIME_COLUMNS);
  return created as OvertimeRow;
}

/** Edits an entry that no payroll draft has taken yet. */
export async function updateHROvertime(input: unknown, actorId: number): Promise<OvertimeRow> {
  const raw = recordOf(input);
  if (!raw) throw new HRPayrollError("Enter the overtime details.");
  const id = positiveId(raw.id, "Overtime entry");
  const values = parseOvertimeEntry(raw);
  await ensureHrSchema();
  const calendar = readHrCalendar();
  const [existing] = await db.select({
    id: hrOvertimeEntries.id,
    userId: hrOvertimeEntries.userId,
    payrollRunId: hrOvertimeEntries.payrollRunId,
  }).from(hrOvertimeEntries).where(eq(hrOvertimeEntries.id, id)).limit(1);
  if (!existing) throw new HRPayrollError("Overtime entry not found.", 404);
  if (existing.payrollRunId) {
    const [run] = await db.select({ periodYear: hrPayrollRuns.periodYear, periodMonth: hrPayrollRuns.periodMonth })
      .from(hrPayrollRuns).where(eq(hrPayrollRuns.id, existing.payrollRunId)).limit(1);
    const period = run ? payrollPeriodLabel(run.periodYear, run.periodMonth) : "a";
    throw new HRPayrollError(`This overtime is already included in the ${period} payroll run — delete that draft first.`, 409);
  }
  const [employee] = await db.select({ id: users.id, name: users.name })
    .from(users).where(eq(users.id, values.userId)).limit(1);
  if (!employee) throw new HRPayrollError("Employee account not found.", 404);
  const onLeave = await workLeaveBlock(values.userId, values.workDate, "assign");
  if (onLeave) throw new HRPayrollError(onLeave.message, 409);
  const [profile] = await db.select({ baseSalaryCents: hrEmployeeProfiles.baseSalaryCents })
    .from(hrEmployeeProfiles).where(eq(hrEmployeeProfiles.userId, values.userId)).limit(1);
  const resolved = resolveOvertime(values, calendar, profile?.baseSalaryCents ?? 0);
  await assertDailyCap(values.userId, values.workDate, values.minutes, calendar, id);
  const [updated] = await db.update(hrOvertimeEntries).set({
    userId: values.userId,
    employeeName: employee.name,
    workDate: values.workDate,
    dayKind: resolved.kind,
    startTime: values.startTime,
    endTime: values.endTime,
    minutes: values.minutes,
    baseRateCentsPerHour: resolved.baseRateCentsPerHour,
    multiplierPercent: resolved.multiplierPercent,
    rateCentsPerHour: resolved.rateCentsPerHour,
    amountCents: resolved.amountCents,
    notes: values.notes,
    reviewedById: actorId,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(hrOvertimeEntries.id, id)).returning(OVERTIME_COLUMNS);
  return updated as OvertimeRow;
}

/** Approves or rejects one or more pending entries. */
export async function reviewHROvertime(input: unknown, reviewerId: number): Promise<OvertimeRow[]> {
  const raw = recordOf(input);
  if (!raw) throw new HRPayrollError("Choose the overtime entries to review.");
  const status = String(raw.status ?? "") as OvertimeStatus;
  if (status !== "Approved" && status !== "Rejected") {
    throw new HRPayrollError("Overtime can only be approved or rejected.");
  }
  const ids = (Array.isArray(raw.ids) ? raw.ids : [raw.id])
    .map((value) => Number(value))
    .filter((value) => Number.isSafeInteger(value) && value > 0)
    .slice(0, 200);
  if (ids.length === 0) throw new HRPayrollError("Choose at least one overtime entry.");
  await ensureHrSchema();
  const rows = await db.update(hrOvertimeEntries).set({
    status,
    reviewedById: reviewerId,
    reviewedAt: new Date(),
    updatedAt: new Date(),
  })
    .where(and(inArray(hrOvertimeEntries.id, ids), eq(hrOvertimeEntries.status, "Pending")))
    .returning(OVERTIME_COLUMNS);
  if (rows.length === 0) throw new HRPayrollError("Those overtime entries have already been reviewed.", 409);
  return rows as OvertimeRow[];
}

/** Deletes an entry; a paid one (Posted run) is a permanent record. */
export async function deleteHROvertime(entryValue: unknown): Promise<{ id: number }> {
  const id = positiveId(entryValue, "Overtime entry");
  await ensureHrSchema();
  const [existing] = await db.select({
    id: hrOvertimeEntries.id,
    payrollRunId: hrOvertimeEntries.payrollRunId,
  }).from(hrOvertimeEntries).where(eq(hrOvertimeEntries.id, id)).limit(1);
  if (!existing) throw new HRPayrollError("Overtime entry not found.", 404);
  if (existing.payrollRunId) {
    const [run] = await db.select({ status: hrPayrollRuns.status, periodYear: hrPayrollRuns.periodYear, periodMonth: hrPayrollRuns.periodMonth })
      .from(hrPayrollRuns).where(eq(hrPayrollRuns.id, existing.payrollRunId)).limit(1);
    const period = run ? payrollPeriodLabel(run.periodYear, run.periodMonth) : "a payroll run";
    if (run?.status === "Posted") {
      throw new HRPayrollError(`This overtime was paid in the posted ${period} payroll and cannot be deleted.`, 409);
    }
    throw new HRPayrollError(`This overtime is included in the ${period} payroll draft — delete that draft first.`, 409);
  }
  await db.delete(hrOvertimeEntries).where(eq(hrOvertimeEntries.id, id));
  return { id };
}

/**
 * Approved, not-yet-paid overtime of one payroll period, grouped per employee —
 * what `createHRPayrollRun` turns into an earnings line.
 */
export async function approvedOvertimeForPeriod(year: number, month: number, executor: Executor = db): Promise<Array<{
  userId: number;
  employeeName: string;
  minutes: number;
  amountCents: number;
  entryIds: number[];
}>> {
  await ensureHrSchema();
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const to = `${year}-${String(month).padStart(2, "0")}-31`;
  const rows = await executor.select(OVERTIME_COLUMNS)
    .from(hrOvertimeEntries)
    .where(and(
      eq(hrOvertimeEntries.status, "Approved"),
      isNull(hrOvertimeEntries.payrollRunId),
      sql`${hrOvertimeEntries.workDate} >= ${from}`,
      sql`${hrOvertimeEntries.workDate} <= ${to}`,
    ))
    .orderBy(asc(hrOvertimeEntries.workDate), asc(hrOvertimeEntries.id));
  const grouped = new Map<number, { userId: number; employeeName: string; minutes: number; amountCents: number; entryIds: number[] }>();
  for (const row of rows as OvertimeRow[]) {
    const key = Number(row.userId);
    const current = grouped.get(key) ?? {
      userId: key,
      employeeName: row.employeeName,
      minutes: 0,
      amountCents: 0,
      entryIds: [],
    };
    current.minutes += Number(row.minutes) || 0;
    current.amountCents += Number(row.amountCents) || 0;
    current.entryIds.push(Number(row.id));
    grouped.set(key, current);
  }
  return Array.from(grouped.values());
}

/** Marks entries as paid by a payroll run (called inside the draft transaction). */
export async function linkOvertimeToRun(entryIds: readonly number[], runId: number, executor: Executor = db): Promise<number> {
  const ids = entryIds.map((value) => Number(value)).filter((n) => Number.isSafeInteger(n) && n > 0);
  if (ids.length === 0) return 0;
  await ensureHrSchema();
  const updated = await executor.update(hrOvertimeEntries)
    .set({ payrollRunId: runId })
    .where(and(inArray(hrOvertimeEntries.id, ids), isNull(hrOvertimeEntries.payrollRunId)))
    .returning({ id: hrOvertimeEntries.id });
  return updated.length;
}

/**
 * Frees the overtime a draft had taken, so deleting an unpaid run puts those
 * hours back in the pool for the next draft. Posted runs never call this.
 */
export async function unlinkOvertimeFromRun(runId: number, executor: Executor = db): Promise<number> {
  const id = Number(runId);
  if (!Number.isSafeInteger(id) || id <= 0) return 0;
  await ensureHrSchema();
  const updated = await executor.update(hrOvertimeEntries)
    .set({ payrollRunId: null })
    .where(eq(hrOvertimeEntries.payrollRunId, id))
    .returning({ id: hrOvertimeEntries.id });
  return updated.length;
}
