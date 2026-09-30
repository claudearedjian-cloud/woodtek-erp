import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { positiveId } from "@/lib/purchasing";
import { receivePurchaseOrder } from "@/lib/purchasing.server";
import { purchasingFailure, PURCHASING_NO_STORE } from "@/lib/purchasingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await authorizeModule("purchasing");
  if (error) return error;
  try {
    const orderId = positiveId((await context.params).id, "Purchase order id");
    const result = await receivePurchaseOrder(orderId, await request.json(), user.id);
    if (!result.replayed) {
      logAudit(user, "purchasing.goods-receipt", "purchase-order", `${result.number} received against PUR-${String(orderId).padStart(5, "0")} · stock incremented`, orderId);
    }
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers: PURCHASING_NO_STORE });
  } catch (cause) {
    return purchasingFailure(cause);
  }
}
