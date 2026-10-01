import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { positiveId } from "@/lib/invoicing";
import { recordPayment } from "@/lib/invoicing.server";
import { invoicingFailure, INVOICING_NO_STORE } from "@/lib/invoicingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await authorizeModule("invoicing");
  if (error) return error;
  try {
    const invoiceId = positiveId((await context.params).id, "Invoice id");
    const result = await recordPayment(invoiceId, await request.json(), user.id);
    logAudit(user, "invoicing.payment-record", "invoice", `payment recorded on invoice #${invoiceId}`, result.id);
    return NextResponse.json(result, { status: 201, headers: INVOICING_NO_STORE });
  } catch (cause) {
    return invoicingFailure(cause);
  }
}
