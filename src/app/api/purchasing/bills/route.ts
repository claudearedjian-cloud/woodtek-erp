import { NextResponse } from "next/server";
import { authorizePayables } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { createSupplierBill } from "@/lib/payables.server";
import { purchasingFailure, PURCHASING_NO_STORE } from "@/lib/purchasingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, error } = await authorizePayables();
  if (error) return error;
  try {
    const result = await createSupplierBill(await request.json(), user.id);
    logAudit(user, "purchasing.bill.create", "supplier-bill", `Recorded ${result.number} · supplier ref ${result.reference}`, result.id);
    return NextResponse.json(result, { status: 201, headers: PURCHASING_NO_STORE });
  } catch (cause) {
    return purchasingFailure(cause);
  }
}
