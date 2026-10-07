import { NextResponse } from "next/server";
import { authorize, authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { HRPayrollError } from "@/lib/hrPayroll";
import {
  createNoLoginEmployee,
  deleteNoLoginEmployee,
  listHREmployees,
  saveHREmployeeProfile,
  setEmployeeActive,
  setEmployeeLogin,
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

/** Create an HR-only employee (no sign-in) with its card shell. */
export async function POST(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const created = await createNoLoginEmployee(await request.json(), user.id);
    logAudit(user, "hr.employee.create", "hr-employee", `HR-only employee ${created.name} created (no login)`, created.id);
    return NextResponse.json(created, { status: 201, headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to create the employee.");
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

/**
 * Account lifecycle inside HR:
 * - enableLogin / disableLogin: hands out or revokes a sign-in (Manager
 *   only — granting access is account administration, not HR data entry).
 * - setActive: activates or deactivates the account (HR grant).
 */
export async function PATCH(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Choose an HR action." }, { status: 400, headers: PRIVATE_HEADERS });
  }
  const action = String(body.action ?? "");
  try {
    if (action === "enableLogin" || action === "disableLogin") {
      const { user, error } = await authorize("users:manage");
      if (error) return privateResponse(error);
      const updated = await setEmployeeLogin(
        { userId: body.userId, enable: action === "enableLogin", role: body.role, pin: body.pin },
        user.id,
      );
      logAudit(
        user,
        action === "enableLogin" ? "hr.login.enable" : "hr.login.disable",
        "hr-employee",
        action === "enableLogin"
          ? `Sign-in enabled for ${updated?.name} (role ${updated?.role})`
          : `Sign-in disabled for ${updated?.name}`,
        updated?.id,
      );
      return NextResponse.json(updated, { headers: PRIVATE_HEADERS });
    }
    if (action === "setActive") {
      const { user, error } = await authorizeModule("payroll");
      if (error) return privateResponse(error);
      const updated = await setEmployeeActive({ userId: body.userId, active: body.active }, user.id);
      logAudit(
        user,
        updated?.active ? "hr.employee.activate" : "hr.employee.deactivate",
        "hr-employee",
        `Employee ${updated?.name} ${updated?.active ? "activated" : "deactivated"}`,
        updated?.id,
      );
      return NextResponse.json(updated, { headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({ error: "Unknown HR action." }, { status: 400, headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to update the employee account.");
  }
}

/**
 * Deletes an HR-only (no-login) employee record. Accounts with a sign-in
 * are refused here — their deletion stays a Manager action in Settings.
 */
export async function DELETE(request: Request) {
  const { user, error } = await authorizeModule("payroll");
  if (error) return privateResponse(error);
  try {
    const userId = Number(new URL(request.url).searchParams.get("userId"));
    const removed = await deleteNoLoginEmployee(userId, user.id);
    logAudit(user, "hr.employee.delete", "hr-employee", `HR-only employee ${removed.name} deleted`, removed.id);
    return NextResponse.json({ success: true }, { headers: PRIVATE_HEADERS });
  } catch (cause) {
    return failure(cause, "Failed to delete the employee.");
  }
}
