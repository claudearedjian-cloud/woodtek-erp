import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { positiveId } from "@/lib/invoicing";
import { cancelDocument } from "@/lib/invoicing.server";
import { invoicingFailure, INVOICING_NO_STORE } from "@/lib/invoicingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await authorizeModule("invoicing");
  if (error) return error;
  try {
    const id = positiveId((await context.params).id, "Document id");
    const result = await cancelDocument(id);
    logAudit(user, "invoicing.document-cancel", "invoice", `document #${id} cancelled (number stays reserved)`, id);
    return NextResponse.json(result, { headers: INVOICING_NO_STORE });
  } catch (cause) {
    return invoicingFailure(cause);
  }
}
