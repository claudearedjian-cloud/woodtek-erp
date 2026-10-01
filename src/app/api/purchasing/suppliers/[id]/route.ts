import { NextResponse } from "next/server";
import { authorizeModule } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { positiveId } from "@/lib/purchasing";
import { updateSupplier } from "@/lib/purchasing.server";
import { purchasingFailure, PURCHASING_NO_STORE } from "@/lib/purchasingRoute.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error } = await authorizeModule("purchasing");
  if (error) return error;
  try {
    const id = positiveId((await context.params).id, "Supplier id");
    const supplier = await updateSupplier(id, await request.json());
    logAudit(user, "purchasing.supplier.update", "supplier", `${supplier.name} · ${supplier.active ? "active" : "archived"}`, id);
    return NextResponse.json(supplier, { headers: PURCHASING_NO_STORE });
  } catch (cause) {
    return purchasingFailure(cause);
  }
}
