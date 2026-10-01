import { NextResponse } from "next/server";
import { authorizePayables } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { positiveId } from "@/lib/purchasing";
import { recordSupplierBillPayment } from "@/lib/payables.server";
import { purchasingFailure, PURCHASING_NO_STORE } from "@/lib/purchasingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await authorizePayables();
  if (error) return error;
  try {
    const billId = positiveId((await context.params).id, "Supplier bill id");
    const result = await recordSupplierBillPayment(billId, await request.json(), user.id);
    if (!result.replayed) {
      logAudit(user, "purchasing.bill.payment", "supplier-bill", `Payment recorded on SB-${String(billId).padStart(6, "0")}`, result.id);
    }
    return NextResponse.json(result, { status: result.replayed ? 200 : 201, headers: PURCHASING_NO_STORE });
  } catch (cause) {
    return purchasingFailure(cause);
  }
}
