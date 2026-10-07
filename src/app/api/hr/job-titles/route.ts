import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { HRPayrollError } from "@/lib/hrPayroll";
import { readJobTitles, sanitizeJobTitles, writeJobTitles } from "@/lib/hrJobTitles.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

function privateResponse(response: NextResponse) {
  response.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
  return response;
}

/**
 * Editable job-description suggestions (Worker, Cleaner, Driver, …).
 * HR-only: the job title on the employee card defaults to the system role,
 * and this list is the fallback choice when the role does not describe the
 * actual job. Free text stays allowed — the list is only the suggestions.
 */
export async function GET() {
  const { error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    return NextResponse.json({ titles: readJobTitles() }, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    console.error("HR job-titles error:", cause);
    return NextResponse.json({ error: "Failed to load job titles." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

export async function PUT(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const body = await request.json().catch(() => ({}));
    const titles = sanitizeJobTitles(body?.titles ?? body);
    writeJobTitles(titles);
    logAudit(user, "hr.job-titles.save", "system", `HR job titles saved (${titles.length} title(s))`);
    return NextResponse.json({ titles }, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    if (cause instanceof HRPayrollError) {
      return NextResponse.json({ error: cause.message }, { status: cause.status, headers: PRIVATE_HEADERS });
    }
    console.error("HR job-titles save error:", cause);
    return NextResponse.json({ error: "Failed to save job titles." }, { status: 500, headers: PRIVATE_HEADERS });
  }
}
