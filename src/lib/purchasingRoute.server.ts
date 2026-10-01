import { NextResponse } from "next/server";
import { PurchasingError } from "@/lib/purchasing";

export const PURCHASING_NO_STORE = { "Cache-Control": "private, no-store, max-age=0" };

export function purchasingFailure(error: unknown): NextResponse {
  if (error instanceof PurchasingError) {
    return NextResponse.json({ error: error.message }, { status: error.status, headers: PURCHASING_NO_STORE });
  }
  const pg = error as { code?: string; cause?: { code?: string } };
  if (pg.code === "23505" || pg.cause?.code === "23505") {
    return NextResponse.json({ error: "A supplier with that name already exists. Refresh and try again." }, { status: 409, headers: PURCHASING_NO_STORE });
  }
  console.error("Purchasing request failed", error);
  return NextResponse.json({ error: "Purchasing could not reach or prepare its database tables. Ask the Manager to check the server log and try again." }, { status: 500, headers: PURCHASING_NO_STORE });
}
