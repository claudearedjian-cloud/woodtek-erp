import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { centsToMoney, JobCostingError, parseJobCostSettings } from "@/lib/jobCosting";
import { readJobCostSettings, writeJobCostSettings } from "@/lib/jobCosting.server";
import { jobCostingFailure, JOB_COSTING_NO_STORE } from "@/lib/jobCostingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authorizeModule("invoicing");
  if (error) return error;
  return NextResponse.json(readJobCostSettings(), { headers: JOB_COSTING_NO_STORE });
}

// The shop labor rate and overhead decide every margin in the factory, so
// changing them is a Manager-only act even for people holding the money grant.
export async function PUT(request: Request) {
  const { user, error } = await authorizeModule("invoicing");
  if (error) return error;
  try {
    if (user.role !== "Manager") throw new JobCostingError("Only a Manager can change the labor rate and overhead.", 403);
    const before = readJobCostSettings();
    const next = writeJobCostSettings(parseJobCostSettings(await request.json()));
    logAudit(
      user,
      "job-costing.settings",
      "job-costing",
      `Labor rate $${centsToMoney(before.laborRateCentsPerHour)} -> $${centsToMoney(next.laborRateCentsPerHour)}/h; ` +
        `overhead ${(before.overheadBps / 100).toFixed(2)}% -> ${(next.overheadBps / 100).toFixed(2)}%`,
    );
    return NextResponse.json(next, { headers: JOB_COSTING_NO_STORE });
  } catch (cause) {
    return jobCostingFailure(cause);
  }
}
