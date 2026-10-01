import { NextResponse } from "next/server";
import { InvoicingError } from "@/lib/invoicing";

export const INVOICING_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

export function invoicingFailure(error: unknown): NextResponse {
  if (error instanceof InvoicingError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: INVOICING_NO_STORE });
  }
  console.error("Invoicing request failed", error);
  return NextResponse.json(
    { error: "Invoicing could not reach or prepare its database tables. Ask the Manager to check the server log and try again." },
    { status: 500, headers: INVOICING_NO_STORE },
  );
}
