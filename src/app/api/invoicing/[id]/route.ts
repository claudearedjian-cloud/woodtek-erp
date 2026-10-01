import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { positiveId } from "@/lib/invoicing";
import { documentDetail } from "@/lib/invoicing.server";
import { invoicingFailure, INVOICING_NO_STORE } from "@/lib/invoicingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { error } = await authorizeModule("invoicing");
  if (error) return error;
  try {
    const id = positiveId((await context.params).id, "Document id");
    return NextResponse.json(await documentDetail(id), { headers: INVOICING_NO_STORE });
  } catch (cause) {
    return invoicingFailure(cause);
  }
}
