import { NextResponse } from "next/server";
import { JobCostingError } from "@/lib/jobCosting";

export const JOB_COSTING_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

export function jobCostingFailure(error: unknown): NextResponse {
  if (error instanceof JobCostingError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: JOB_COSTING_NO_STORE });
  }
  console.error("Job costing request failed", error);
  return NextResponse.json(
    { error: "Job costing could not be calculated. Ask the Manager to check the server log and try again." },
    { status: 500, headers: JOB_COSTING_NO_STORE },
  );
}
