// ============================================================================
// Salary history — dated ledger of base-salary changes per employee. Entries
// are recorded automatically when the card's monthly salary changes; older
// changes can also be backfilled by hand. HR-private: every handler requires
// the HR & Payroll grant. A ledger only — payroll drafts keep snapshotting
// the profile's current base salary, never this table.
// ============================================================================

import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { HRPayrollError } from "@/lib/hrPayroll";
import {
  addSalaryHistoryEntry,
  deleteSalaryHistoryEntry,
  listSalaryHistory,
} from "@/lib/hrPayroll.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
  return response;
}

function failure(cause: unknown, fallback: string) {
  if (cause instanceof HRPayrollError) {
    return NextResponse.json({ error: cause.message }, { status: cause.status, headers: PRIVATE_HEADERS });
  }
  console.error("HR salary history error:", cause);
  return NextResponse.json({ error: fallback }, { status: 500, headers: PRIVATE_HEADERS });
}

/** GET ?userId=… lists the employee's salary history, newest first. */
export async function GET(request: Request) {
  const { error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const userId = Number(new URL(request.url).searchParams.get("userId"));
    return NextResponse.json(await listSalaryHistory(userId), { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to load the salary history.");
  }
}

/** Records one salary change (effective date + monthly amount + note). */
export async function POST(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const created = await addSalaryHistoryEntry(await request.json(), user.id);
    logAudit(
      user,
      "hr.salary.add",
      "hr-employee",
      `Salary entry recorded for employee #${created.userId}: $${(created.monthlyAmountCents / 100).toFixed(2)}/mo since ${created.effectiveDate}`,
      created.userId,
    );
    return NextResponse.json(created, { status: 201, headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to record the salary change.");
  }
}

/** Deletes one salary-history entry (typing corrections). */
export async function DELETE(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    const removed = await deleteSalaryHistoryEntry(id);
    logAudit(
      user,
      "hr.salary.delete",
      "hr-employee",
      `Salary entry of ${removed.effectiveDate} deleted for employee #${removed.userId}`,
      removed.userId,
    );
    return NextResponse.json({ ok: true }, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to delete the salary entry.");
  }
}
