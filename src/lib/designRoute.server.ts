import { NextResponse } from "next/server";
import { DesignDepartmentError } from "@/lib/designDepartment";

export const DESIGN_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

export function designFailure(error: unknown): NextResponse {
  if (error instanceof DesignDepartmentError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status, headers: DESIGN_NO_STORE },
    );
  }
  const pg = error as { code?: string; cause?: { code?: string } };
  if (pg.code === "23505" || pg.cause?.code === "23505") {
    return NextResponse.json(
      {
        error:
          "That project already has this drawing number and revision. Refresh the register and use a different revision.",
      },
      { status: 409, headers: DESIGN_NO_STORE },
    );
  }
  console.error("Design Department request failed", error);
  return NextResponse.json(
    {
      error:
        "Design Department could not reach or prepare its database tables. Ask the Manager to check the server log and try again.",
    },
    { status: 500, headers: DESIGN_NO_STORE },
  );
}
