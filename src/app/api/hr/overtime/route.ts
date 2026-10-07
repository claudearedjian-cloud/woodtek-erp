import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { HRPayrollError } from "@/lib/hrPayroll";
import { formatMinutes } from "@/lib/hrCalendar";
import {
  createHROvertime,
  deleteHROvertime,
  listHROvertime,
  reviewHROvertime,
  suggestOvertimeRate,
  updateHROvertime,
} from "@/lib/hrOvertime.server";
import { readHrCalendar } from "@/lib/hrCalendar.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
  return response;
}

function failure(error: unknown, fallback: string) {
  if (error instanceof HRPayrollError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: PRIVATE_HEADERS });
  }
  console.error("HR overtime error:", error);
  return NextResponse.json({ error: fallback }, { status: 500, headers: PRIVATE_HEADERS });
}

/**
 * Overtime register. Money-bearing, so the whole route sits behind the HR &
 * Payroll grant — the same switch that owns the employee card and payslips.
 *
 * GET  ?year=&month=&userId=&status=&unpaid=1        → entries (+ calendar)
 * GET  ?suggest=1&userId=&workDate=&minutes=…        → live rate suggestion
 */
export async function GET(request: Request) {
  const { error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("suggest") === "1") {
      const suggestion = await suggestOvertimeRate({
        userId: url.searchParams.get("userId"),
        workDate: url.searchParams.get("workDate"),
        minutes: Number(url.searchParams.get("minutes") ?? 60),
        startTime: url.searchParams.get("startTime") ?? "",
        endTime: url.searchParams.get("endTime") ?? "",
        rateCentsPerHour: Number(url.searchParams.get("rateCentsPerHour") ?? 0),
      });
      return NextResponse.json({ suggestion }, { headers: PRIVATE_HEADERS });
    }
    const year = Number(url.searchParams.get("year") ?? "");
    const month = Number(url.searchParams.get("month") ?? "");
    const entries = await listHROvertime({
      year: Number.isInteger(year) && year > 0 ? year : undefined,
      month: Number.isInteger(month) && month > 0 ? month : undefined,
      userId: Number(url.searchParams.get("userId") ?? "") || undefined,
      status: url.searchParams.get("status") ?? undefined,
      unpaidOnly: url.searchParams.get("unpaid") === "1",
    });
    return NextResponse.json({ entries, calendar: readHrCalendar() }, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to load overtime.");
  }
}

/** Record overtime hours for one employee. */
export async function POST(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const created = await createHROvertime(await request.json(), user.id);
    logAudit(
      user,
      "hr.overtime.create",
      "hr-overtime",
      `${formatMinutes(created.minutes)} overtime recorded for ${created.employeeName} on ${created.workDate} (${created.dayKind})`,
      created.id,
    );
    return NextResponse.json(created, { status: 201, headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to record overtime.");
  }
}

/** Edit an overtime entry that no payroll run has taken yet. */
export async function PUT(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const updated = await updateHROvertime(await request.json(), user.id);
    logAudit(
      user,
      "hr.overtime.update",
      "hr-overtime",
      `Overtime #${updated.id} updated for ${updated.employeeName} (${updated.workDate})`,
      updated.id,
    );
    return NextResponse.json(updated, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to update overtime.");
  }
}

/** Approve or reject pending entries. */
export async function PATCH(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const body = await request.json();
    const reviewed = await reviewHROvertime(body, user.id);
    logAudit(
      user,
      "hr.overtime.review",
      "hr-overtime",
      `${reviewed.length} overtime entr${reviewed.length === 1 ? "y" : "ies"} ${String(body?.status ?? "").toLowerCase()}`,
      reviewed[0]?.id,
    );
    return NextResponse.json({ reviewed }, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to review overtime.");
  }
}

/** Delete an unpaid overtime entry. */
export async function DELETE(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const id = Number(new URL(request.url).searchParams.get("id"));
    const removed = await deleteHROvertime(id);
    logAudit(user, "hr.overtime.delete", "hr-overtime", `Overtime entry #${removed.id} deleted`, removed.id);
    return NextResponse.json({ success: true, id: removed.id }, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to delete overtime.");
  }
}
