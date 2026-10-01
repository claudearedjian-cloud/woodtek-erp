import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { positiveId } from "@/lib/purchasing";
import { finishPurchaseOrder } from "@/lib/purchasing.server";
import { purchasingFailure, PURCHASING_NO_STORE } from "@/lib/purchasingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await authorizeModule("purchasing");
  if (error) return error;
  try {
    const id = positiveId((await context.params).id, "Purchase order id");
    const body = await request.json();
    const result = await finishPurchaseOrder(id, body?.status);
    logAudit(user, "purchasing.order.finish", "purchase-order", `${result.status} PUR-${String(id).padStart(5, "0")}`, id);
    return NextResponse.json(result, { headers: PURCHASING_NO_STORE });
  } catch (cause) {
    return purchasingFailure(cause);
  }
}
