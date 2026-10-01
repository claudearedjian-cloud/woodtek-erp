import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { positiveId } from "@/lib/invoicing";
import { deletePayment } from "@/lib/invoicing.server";
import { invoicingFailure, INVOICING_NO_STORE } from "@/lib/invoicingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await authorizeModule("invoicing");
  if (error) return error;
  try {
    const id = positiveId((await context.params).id, "Payment id");
    const result = await deletePayment(id, user.id);
    logAudit(user, "invoicing.payment-delete", "invoice", `payment #${id} removed from invoice #${result.invoiceId}`, id);
    return NextResponse.json(result, { headers: INVOICING_NO_STORE });
  } catch (cause) {
    return invoicingFailure(cause);
  }
}
