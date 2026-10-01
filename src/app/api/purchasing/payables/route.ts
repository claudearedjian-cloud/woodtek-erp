import { NextResponse } from "next/server";
import { authorizePayables } from "@/lib/auth";
import { supplierPayablesBoard } from "@/lib/payables.server";
import { purchasingFailure, PURCHASING_NO_STORE } from "@/lib/purchasingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { error } = await authorizePayables();
  if (error) return error;
  try {
    return NextResponse.json(await supplierPayablesBoard(), { headers: PURCHASING_NO_STORE });
  } catch (cause) {
    return purchasingFailure(cause);
  }
}
