import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { parseRange, parseScope } from "@/lib/jobCosting";
import { jobCostingBoard } from "@/lib/jobCosting.server";
import { jobCostingFailure, JOB_COSTING_NO_STORE } from "@/lib/jobCostingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Job costing is money: it sits behind the Invoicing & Money grant, enforced
// here on the server (the sidebar only hides the screen).
export async function GET(request: Request) {
  const { user, error } = await authorizeModule("invoicing");
  if (error) return error;
  try {
    const url = new URL(request.url);
    const board = await jobCostingBoard(user, parseRange(url.searchParams.get("range")), parseScope(url.searchParams.get("scope")));
    return NextResponse.json(board, { headers: JOB_COSTING_NO_STORE });
  } catch (cause) {
    return jobCostingFailure(cause);
  }
}
