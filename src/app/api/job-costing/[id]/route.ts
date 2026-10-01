import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { JobCostingError } from "@/lib/jobCosting";
import { jobCostDetail } from "@/lib/jobCosting.server";
import { jobCostingFailure, JOB_COSTING_NO_STORE } from "@/lib/jobCostingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await authorizeModule("invoicing");
  if (error) return error;
  try {
    const { id } = await context.params;
    const orderId = Number(id);
    if (!Number.isInteger(orderId) || orderId <= 0) throw new JobCostingError("Order not found.", 404);
    return NextResponse.json(await jobCostDetail(user, orderId), { headers: JOB_COSTING_NO_STORE });
  } catch (cause) {
    return jobCostingFailure(cause);
  }
}
