import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { HRPayrollError } from "@/lib/hrPayroll";
import { listHREmployees, saveHREmployeeProfile } from "@/lib/hrPayroll.server";

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
  console.error("HR employees error:", error);
  return NextResponse.json({ error: fallback }, { status: 500, headers: PRIVATE_HEADERS });
}

/** HR-only directory view with compensation kept out of the general users API. */
export async function GET() {
  const { error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    return NextResponse.json(await listHREmployees(), { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to load HR employee profiles.");
  }
}

/** Create or update one employee's private pay profile. */
export async function PUT(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const saved = await saveHREmployeeProfile(await request.json(), user.id);
    logAudit(user, "hr.profile.save", "hr-employee", `HR profile saved for employee #${saved.userId}`, saved.userId);
    return NextResponse.json({ success: true, userId: saved.userId }, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to save the HR employee profile.");
  }
}
