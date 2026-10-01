import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { positiveId } from "@/lib/invoicing";
import { convertQuote } from "@/lib/invoicing.server";
import { invoicingFailure, INVOICING_NO_STORE } from "@/lib/invoicingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await authorizeModule("invoicing");
  if (error) return error;
  try {
    const id = positiveId((await context.params).id, "Quotation id");
    const body = await request.json().catch(() => ({}));
    const result = await convertQuote(id, body, user.id);
    logAudit(user, "invoicing.quote-convert", "invoice", `${result.from} converted to ${result.number}`, result.id);
    return NextResponse.json(result, { status: 201, headers: INVOICING_NO_STORE });
  } catch (cause) {
    return invoicingFailure(cause);
  }
}
