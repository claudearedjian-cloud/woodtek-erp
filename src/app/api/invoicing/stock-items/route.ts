import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { listStockIdentity } from "@/lib/invoicing.server";
import { invoicingFailure, INVOICING_NO_STORE } from "@/lib/invoicingRoute.server";

// The line description picker's stock list. Same Invoicing & Money grant as
// the rest of the screen, and identity fields only — this response can never
// carry costs or quantities (see listStockIdentity).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authorizeModule("invoicing");
  if (error) return error;
  try {
    return NextResponse.json({ items: await listStockIdentity() }, { headers: INVOICING_NO_STORE });
  } catch (cause) {
    return invoicingFailure(cause);
  }
}
