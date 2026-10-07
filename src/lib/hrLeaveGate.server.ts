// ============================================================================
// "Is this employee at work?" gate — SERVER ONLY.
//
// One approved leave record makes an employee unavailable: they cannot sign
// in, they cannot be given a task or a shift, and work cannot be started or
// reported in their name. Every refusal carries the SAME sentence (built by
// leaveBlockMessage) so the shop floor hears one clear reason instead of a
// generic 403: "Rami is on annual leave until 12 Oct 2026 …".
//
// Design notes
// - Only **Approved** leave blocks. A Pending request changes nothing until HR
//   approves it, and a Declined one never does.
// - The HR tables are created lazily on the first granted HR visit, so this
//   module never assumes they exist: it asks the catalog once and fails OPEN
//   (never locks the whole factory out because of a missing table or a DB
//   hiccup).
// - Safety valve: the last active Manager sign-in is never blocked by their own
//   leave, for the same reason the app refuses to disable that account in HR —
//   somebody must always be able to sign in and fix the calendar.
// ============================================================================

import { and, eq, gte, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { hrLeaveRequests, users } from "@/db/schema";
import { leaveBlockMessage, type LeaveBlockInfo } from "@/lib/hrCalendar";
import { readHrCalendar } from "@/lib/hrCalendar.server";
import { baseRoleOf } from "@/lib/permissions";
import { ensureRolesRegistered } from "@/lib/rolesConfig.server";

/** Which action is being refused — decides the wording of the prompt. */
export type LeaveBlockedAction = "login" | "assign" | "process";

export interface LeaveBlock extends LeaveBlockInfo {
  userId: number;
  leaveId: number;
  status: "Approved";
  /** Ready-made sentence for the API error body / UI prompt. */
  message: string;
  /** Compact payload the client can show in its own dialog. */
  onLeave: {
    userId: number;
    employeeName: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    action: LeaveBlockedAction;
  };
}

// --------------------------------------------------------------- date helper

/** Factory-local calendar date (the leave dates are local, not UTC). */
export function todayYmd(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * YYYY-MM-DD of a Date/string, in factory-local time, or undefined when it
 * cannot be read — callers then fall back to "today".
 */
export function dateToYmd(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) return todayYmd(value);
  return undefined;
}

function validYmd(value: unknown): string {
  const text = String(value ?? "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : todayYmd();
}

// ------------------------------------------------------------ table presence

let tableReady = false;
let missingCheckedAt = 0;
const MISSING_RECHECK_MS = 30_000;

/** True once `hr_leave_requests` exists in this database (cached per process). */
async function leaveTableReady(): Promise<boolean> {
  if (tableReady) return true;
  if (Date.now() - missingCheckedAt < MISSING_RECHECK_MS) return false;
  missingCheckedAt = Date.now();
  try {
    const result = await db.execute<{ reg: string | null }>(
      sql`select to_regclass('public.hr_leave_requests') as reg`,
    );
    const rows = Array.isArray(result) ? result : (result as { rows?: Array<{ reg: string | null }> }).rows ?? [];
    tableReady = Boolean(rows[0]?.reg);
  } catch {
    tableReady = false;
  }
  return tableReady;
}

// --------------------------------------------------------------- policy read

/** Is the sign-in block switched on in HR → Working calendar? */
export function loginBlockingEnabled(): boolean {
  return blockingEnabled("login");
}

/** Is the work-assignment/processing block switched on? */
export function workBlockingEnabled(): boolean {
  return blockingEnabled("work");
}

function blockingEnabled(kind: "login" | "work"): boolean {
  try {
    const policy = readHrCalendar().leaveAccess;
    return kind === "login" ? policy.blockLogin : policy.blockWork;
  } catch {
    // An unreadable calendar must never lock anybody out.
    return false;
  }
}

/** True when blocking this Manager would leave no other Manager sign-in. */
async function isLastLoginManager(userId: number): Promise<boolean> {
  try {
    ensureRolesRegistered();
    const rows = await db.select({ id: users.id, role: users.role })
      .from(users)
      .where(and(eq(users.active, true), eq(users.canLogin, true)));
    const managers = rows.filter((row) => (baseRoleOf(row.role) || row.role) === "Manager");
    return managers.length > 0 && managers.every((row) => row.id === userId);
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------- lookups

interface LeaveRow {
  id: number;
  userId: number | null;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
}

const LEAVE_SELECT = {
  id: hrLeaveRequests.id,
  userId: hrLeaveRequests.userId,
  employeeName: hrLeaveRequests.employeeName,
  leaveType: hrLeaveRequests.leaveType,
  startDate: hrLeaveRequests.startDate,
  endDate: hrLeaveRequests.endDate,
};

/**
 * Today's approved leave, cached for a few seconds: `getSessionUser` runs on
 * every single request, so the session gate must not add a query each time.
 * 15 s of staleness is invisible to a shop floor and keeps the hot path free.
 */
const TODAY_CACHE_MS = 15_000;
let todayCache: { date: string; at: number; rows: Map<number, LeaveRow> } | null = null;

export function resetLeaveGateCache(): void {
  tableReady = false;
  missingCheckedAt = 0;
  todayCache = null;
}

async function leaveRowsOn(date: string): Promise<Map<number, LeaveRow>> {
  const out = new Map<number, LeaveRow>();
  if (!(await leaveTableReady())) return out;
  if (date === todayYmd() && todayCache && Date.now() - todayCache.at < TODAY_CACHE_MS) {
    return new Map(todayCache.rows);
  }
  try {
    const rows = await db.select(LEAVE_SELECT)
      .from(hrLeaveRequests)
      .where(and(
        eq(hrLeaveRequests.status, "Approved"),
        lte(hrLeaveRequests.startDate, date),
        gte(hrLeaveRequests.endDate, date),
      ))
      .orderBy(hrLeaveRequests.endDate);
    for (const row of rows as LeaveRow[]) {
      if (row.userId == null) continue;
      const key = Number(row.userId);
      if (!out.has(key)) out.set(key, row);
    }
    if (date === todayYmd()) todayCache = { date, at: Date.now(), rows: new Map(out) };
  } catch {
    /* fail open: a database hiccup must never lock the factory out */
  }
  return out;
}

function toBlock(row: LeaveRow, action: LeaveBlockedAction): LeaveBlock {
  const info: LeaveBlockInfo = {
    employeeName: row.employeeName,
    leaveType: row.leaveType,
    startDate: row.startDate,
    endDate: row.endDate,
  };
  return {
    ...info,
    userId: Number(row.userId),
    leaveId: row.id,
    status: "Approved",
    message: leaveBlockMessage(info, action),
    onLeave: {
      userId: Number(row.userId),
      employeeName: row.employeeName,
      leaveType: row.leaveType,
      startDate: row.startDate,
      endDate: row.endDate,
      action,
    },
  };
}

/**
 * The approved leave covering `userId` on `date`, or null when they are
 * available. Never throws: a missing table or a failed query means "available"
 * so a database problem cannot stop the whole factory from working.
 */
export async function approvedLeaveFor(
  userId: unknown,
  date?: string,
  action: LeaveBlockedAction = "assign",
): Promise<LeaveBlock | null> {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const day = validYmd(date);
  const rows = await leaveRowsOn(day);
  const row = rows.get(id);
  return row ? toBlock(row, action) : null;
}

/** Batch variant: userId → block, for rosters and pickers (one query). */
export async function approvedLeaveMap(
  userIds: readonly number[],
  date?: string,
  action: LeaveBlockedAction = "assign",
): Promise<Map<number, LeaveBlock>> {
  const out = new Map<number, LeaveBlock>();
  const ids = Array.from(new Set(userIds.map((value) => Number(value)).filter((n) => Number.isInteger(n) && n > 0)));
  if (ids.length === 0) return out;
  const day = validYmd(date);
  const rows = await leaveRowsOn(day);
  for (const id of ids) {
    const row = rows.get(id);
    if (row) out.set(id, toBlock(row, action));
  }
  return out;
}

/**
 * Sign-in gate. Returns the block when this employee may not sign in today:
 * approved leave + the login rule switched on + not the last Manager.
 */
export async function loginLeaveBlock(userId: unknown, role?: string): Promise<LeaveBlock | null> {
  if (!blockingEnabled("login")) return null;
  const block = await approvedLeaveFor(userId, todayYmd(), "login");
  if (!block) return null;
  ensureRolesRegistered();
  const base = baseRoleOf(String(role ?? "")) || String(role ?? "");
  if (base === "Manager" && (await isLastLoginManager(Number(userId)))) return null;
  return block;
}

/** Assignment / processing gate: null when the employee is available. */
export async function workLeaveBlock(
  userId: unknown,
  date?: string,
  action: LeaveBlockedAction = "assign",
): Promise<LeaveBlock | null> {
  if (!blockingEnabled("work")) return null;
  return approvedLeaveFor(userId, date, action);
}

/**
 * Batch assignment gate for a list of candidate employees (a machine crew, a
 * shift plan, a multi-step save): every blocked id with its prompt.
 */
export async function workLeaveBlocks(
  userIds: readonly number[],
  date?: string,
  action: LeaveBlockedAction = "assign",
): Promise<LeaveBlock[]> {
  if (!blockingEnabled("work")) return [];
  const map = await approvedLeaveMap(userIds, date, action);
  return Array.from(map.values());
}

/**
 * Compact availability list for the sign-in roster and the operator pickers:
 * who is on approved leave on `date`. Exposes the leave TYPE and its end date
 * (needed for a useful prompt) but never the notes or any medical detail.
 */
export async function employeesOnLeave(date?: string): Promise<Array<{
  userId: number;
  employeeName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  message: string;
}>> {
  const rows = await leaveRowsOn(validYmd(date));
  return Array.from(rows.values())
    .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
    .map((row) => ({
      userId: Number(row.userId),
      employeeName: row.employeeName,
      leaveType: row.leaveType,
      startDate: row.startDate,
      endDate: row.endDate,
      message: leaveBlockMessage(row, "assign"),
    }));
}
