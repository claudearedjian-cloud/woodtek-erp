import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { HRPayrollError } from "@/lib/hrPayroll";
import { createHRLeave, listHRLeave, reviewHRLeave } from "@/lib/hrPayroll.server";

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
  console.error("HR leave error:", error);
  return NextResponse.json({ error: fallback }, { status: 500, headers: PRIVATE_HEADERS });
}

/** Leave and absence register. Every response is protected by the HR grant. */
export async function GET() {
  const { error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    return NextResponse.json(await listHRLeave(), { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to load leave and absence records.");
  }
}

/** Record a leave request for an active employee. */
export async function POST(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const created = await createHRLeave(await request.json(), user.id);
    logAudit(
      user,
      "hr.leave.create",
      "hr-leave",
      `${created.leaveType} leave recorded for employee #${created.userId} (${created.startDate} to ${created.endDate})`,
      created.id,
    );
    return NextResponse.json(created, { status: 201, headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to record leave.");
  }
}

/** Approve or decline a pending leave request. */
export async function PATCH(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const updated = await reviewHRLeave(await request.json(), user.id);
    logAudit(user, "hr.leave.review", "hr-leave", `Leave #${updated.id} ${updated.status.toLowerCase()}`, updated.id);
    return NextResponse.json(updated, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to review leave.");
  }
}
