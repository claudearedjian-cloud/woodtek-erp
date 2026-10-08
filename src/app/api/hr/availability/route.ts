import { NextResponse } from "next/server";
import { authorize } from "@/lib/auth";
import { employeesOnLeave, todayYmd } from "@/lib/hrLeaveGate.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

/**
 * Who is on approved leave on a given day — the operational half of the HR
 * leave gate. Every screen that assigns work (shift planner, station crew,
 * machine roster, dispatch) reads this to label an employee BEFORE the save is
 * attempted, so the supervisor sees "on annual leave until 12 Oct 2026" in the
 * picker instead of a bare 409 afterwards.
 *
 * Deliberately minimal and NOT behind the payroll grant: it exposes only the
 * employee id/name, the leave TYPE and its end date. No salary, no notes, no
 * medical detail. Any signed-in user may read it; the server-side gate in
 * /api/operations, /api/shifts/assignments, /api/attendance and /api/auth stays
 * authoritative regardless of what a client does with this list.
 *
 * GET ?date=YYYY-MM-DD (defaults to today).
 */
export async function GET(request: Request) {
  const { error } = await authorize();
  if (error) {
    error.headers.set("Cache-Control", PRIVATE_HEADERS["Cache-Control"]);
    return error;
  }
  try {
    const url = new URL(request.url);
    const requested = url.searchParams.get("date") ?? "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayYmd();
    const onLeave = await employeesOnLeave(date);
    return NextResponse.json(
      { date, onLeave },
      { headers: PRIVATE_HEADERS },
    );
  } catch (cause) {
    console.error("HR availability error:", cause);
    return NextResponse.json(
      { error: "Failed to load leave availability." },
      { status: 500, headers: PRIVATE_HEADERS },
    );
  }
}
