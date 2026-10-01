import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { createSupplier } from "@/lib/purchasing.server";
import { purchasingFailure, PURCHASING_NO_STORE } from "@/lib/purchasingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const { user, error } = await authorizeModule("purchasing");
  if (error) return error;
  try {
    const supplier = await createSupplier(await request.json());
    logAudit(user, "purchasing.supplier.create", "supplier", `Created ${supplier.name}`, supplier.id);
    return NextResponse.json(supplier, { status: 201, headers: PURCHASING_NO_STORE });
  } catch (cause) {
    return purchasingFailure(cause);
  }
}
