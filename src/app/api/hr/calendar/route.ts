import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { HRPayrollError } from "@/lib/hrPayroll";
import { describeCalendar } from "@/lib/hrCalendar";
import { readHrCalendar, writeHrCalendar } from "@/lib/hrCalendar.server";

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
  console.error("HR calendar error:", error);
  return NextResponse.json({ error: fallback }, { status: 500, headers: PRIVATE_HEADERS });
}

/**
 * Working calendar: work days, daily hours, national & religious holidays, the
 * overtime policy and the leave-access rules. Saved in data/hr-calendar.json —
 * no database migration, one company-wide setting.
 */
export async function GET() {
  const { error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    return NextResponse.json({ calendar: readHrCalendar() }, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to load the working calendar.");
  }
}

export async function PUT(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const body = await request.json().catch(() => ({}));
    const calendar = writeHrCalendar(body?.calendar ?? body);
    logAudit(
      user,
      "hr.calendar.save",
      "system",
      `HR working calendar saved — ${describeCalendar(calendar)}, ${calendar.holidays.length} holiday(s), `
      + `leave rules: sign-in ${calendar.leaveAccess.blockLogin ? "blocked" : "allowed"}, `
      + `work ${calendar.leaveAccess.blockWork ? "blocked" : "allowed"}`,
    );
    return NextResponse.json({ calendar }, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to save the working calendar.");
  }
}
