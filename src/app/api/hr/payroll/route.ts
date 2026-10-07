import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { HRPayrollError, parsePayrollPeriod } from "@/lib/hrPayroll";
import {
  createHRPayrollRun,
  deleteHRPayrollRun,
  getHRPayrollBoard,
  postHRPayrollRun,
  updateHRPayrollItem,
} from "@/lib/hrPayroll.server";

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
  console.error("HR payroll error:", error);
  return NextResponse.json({ error: fallback }, { status: 500, headers: PRIVATE_HEADERS });
}

/** Draft/history read, with salary data never exposed outside the payroll grant. */
export async function GET(request: Request) {
  const { error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const url = new URL(request.url);
    const now = new Date();
    const { year, month } = parsePayrollPeriod(
      url.searchParams.get("year") || now.getFullYear(),
      url.searchParams.get("month") || now.getMonth() + 1,
    );
    return NextResponse.json(await getHRPayrollBoard(year, month), { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to load payroll.");
  }
}

/** Create a monthly draft from active employees with HR salary profiles. */
export async function POST(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const run = await createHRPayrollRun(await request.json(), user.id);
    logAudit(user, "hr.payroll.create", "hr-payroll", `Draft payroll created for ${run.periodYear}-${String(run.periodMonth).padStart(2, "0")} (${run.items.length} employees)`, run.id);
    return NextResponse.json(run, { status: 201, headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to create the payroll draft.");
  }
}

/** Edit draft adjustments or lock an approved payroll run as Posted. */
export async function PATCH(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const body = await request.json();
    if (body?.action === "adjust") {
      const item = await updateHRPayrollItem(body);
      logAudit(user, "hr.payroll.adjust", "hr-payslip", `Draft payroll adjustments updated for employee #${item.userId ?? "archived"}`, item.id);
      return NextResponse.json(item, { headers: PRIVATE_HEADERS });
    }
    if (body?.action === "post") {
      const run = await postHRPayrollRun(body.runId, user.id);
      logAudit(user, "hr.payroll.post", "hr-payroll", `Payroll posted for ${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}`, run.id);
      return NextResponse.json(run, { headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({ error: "Choose a supported payroll action." }, { status: 400, headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to update payroll.");
  }
}

/** Drafts can be discarded before posting; posted payroll remains permanent. */
export async function DELETE(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const runId = new URL(request.url).searchParams.get("runId");
    const deleted = await deleteHRPayrollRun(runId);
    logAudit(user, "hr.payroll.delete-draft", "hr-payroll", `Unposted payroll draft #${deleted.id} deleted`, deleted.id);
    return NextResponse.json({ success: true }, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to delete the payroll draft.");
  }
}
