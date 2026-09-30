import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { canSeeMoney } from "@/lib/optionalModules";
import { readOptionalModules } from "@/lib/optionalModules.server";
import { createPurchaseOrder } from "@/lib/purchasing.server";
import { purchasingFailure, PURCHASING_NO_STORE } from "@/lib/purchasingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, error } = await authorizeModule("purchasing");
  if (error) return error;
  try {
    const result = await createPurchaseOrder(await request.json(), user.id, canSeeMoney(user, readOptionalModules()));
    logAudit(user, "purchasing.order.create", "purchase-order", `Created ${result.number}`, result.id);
    return NextResponse.json(result, { status: 201, headers: PURCHASING_NO_STORE });
  } catch (cause) {
    return purchasingFailure(cause);
  }
}
