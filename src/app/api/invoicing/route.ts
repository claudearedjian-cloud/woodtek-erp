import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { InvoicingError } from "@/lib/invoicing";
import { createDocument, invoicingBoard } from "@/lib/invoicing.server";
import { invoicingFailure, INVOICING_NO_STORE } from "@/lib/invoicingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authorizeModule("invoicing");
  if (error) return error;
  try {
    return NextResponse.json(await invoicingBoard(), { headers: INVOICING_NO_STORE });
  } catch (cause) {
    return invoicingFailure(cause);
  }
}

export async function POST(request: Request) {
  const { user, error } = await authorizeModule("invoicing");
  if (error) return error;
  try {
    const body = await request.json();
    const kind = body?.kind === "Quote" ? "Quote" : body?.kind === "Invoice" ? "Invoice" : null;
    if (!kind) throw new InvoicingError("Choose Quote or Invoice.");
    const result = await createDocument(kind, body, user.id);
    logAudit(
      user,
      kind === "Quote" ? "invoicing.quote-create" : "invoicing.invoice-create",
      "invoice",
      `${result.number} created`,
      result.id,
    );
    return NextResponse.json(result, { status: 201, headers: INVOICING_NO_STORE });
  } catch (cause) {
    return invoicingFailure(cause);
  }
}
