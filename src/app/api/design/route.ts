import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { createDesignDrawing, designBoard } from "@/lib/designDepartment.server";
import { DESIGN_NO_STORE, designFailure } from "@/lib/designRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authorizeModule("design");
  if (error) return error;
  try {
    return NextResponse.json(await designBoard(), { headers: DESIGN_NO_STORE });
  } catch (cause) {
    return designFailure(cause);
  }
}

export async function POST(request: Request) {
  const { user, error } = await authorizeModule("design");
  if (error) return error;
  try {
    const result = await createDesignDrawing(await request.json(), user);
    logAudit(user, "design.drawing.create", "design-drawing", `Created ${result.recordNumber}`, result.id);
    return NextResponse.json(result, { status: 201, headers: DESIGN_NO_STORE });
  } catch (cause) {
    return designFailure(cause);
  }
}
