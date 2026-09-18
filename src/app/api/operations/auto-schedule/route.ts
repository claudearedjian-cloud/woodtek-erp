import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { autoScheduleDispatchSlots } from "@/lib/dispatchScheduling.server";

// ============================================================================
// POST /api/operations/auto-schedule
// Backlog/recovery action for operations that do not yet have appointments.
// Freshly issued orders call the same scheduler automatically from /api/orders.
// Existing bookings, private material-chain order, priority, due dates and
// machine availability are enforced by the shared server planner.
// ============================================================================

export async function POST() {
  const { user, error: authError } = await authorize("operations:update-status");
  if (authError || !user) {
    return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    return NextResponse.json(await autoScheduleDispatchSlots());
  } catch (error: unknown) {
    console.error("POST auto-schedule error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to auto-schedule operations" },
      { status: 500 },
    );
  }
}
