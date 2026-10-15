// ============================================================================
// Reset ALL orders (Manager only). Like a reset button, but only for orders.
//   GET  — preview: how many orders, steps, allocations, consumption records
//          and invoices would be removed. Writes nothing.
//   POST — { confirmText: "DELETE ALL ORDERS", deleteInvoices, deleteInventoryRecords }
//          Removes every order with its steps, material allocations and
//          consumption history in ONE transaction, then clears the JSON
//          order overlays. Stock quantities are never changed.
//          Invoices are kept unless deleteInvoices is true; then only the
//          invoices (with lines and payments) of the clients that own these
//          orders are removed. Keeping inventory records is refused while
//          any exist, because the database deletes them with their order.
// Every reset is audited.
// ============================================================================

import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  orders,
  orderOperations,
  orderMaterials,
  materialConsumptions,
  invoices,
  invoiceLines,
  invoicePayments,
} from "@/db/schema";
import { authorize } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { baseRoleOf } from "@/lib/permissions";
import { clearAllOrderRuntimeState } from "@/lib/orderCleanup.server";
import { inArray, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const RESET_CONFIRM_TEXT = "DELETE ALL ORDERS";

async function requireManager() {
  const { user, error } = await authorize("orders:delete");
  if (error) return { user: null, error };
  if (baseRoleOf(user.role) !== "Manager") {
    return { user: null, error: NextResponse.json({ error: "Only a Manager can reset all orders." }, { status: 403 }) };
  }
  return { user, error: null };
}

async function loadPreview() {
  const [orderRows, opRows, allocRows, consRows] = await Promise.all([
    db.select({ id: orders.id, customerId: orders.customerId }).from(orders),
    db.select({ count: sql<number>`count(*)` }).from(orderOperations),
    db.select({ count: sql<number>`count(*)` }).from(orderMaterials),
    db.select({ count: sql<number>`count(*)` }).from(materialConsumptions),
  ]);
  const customerIds = [...new Set(orderRows.map((o) => o.customerId).filter((id): id is number => typeof id === "number"))];
  const invoiceRows = customerIds.length
    ? await db
        .select({
          id: invoices.id,
          number: invoices.number,
          kind: invoices.kind,
          status: invoices.status,
          customerName: invoices.customerName,
          totalCents: invoices.totalCents,
        })
        .from(invoices)
        .where(inArray(invoices.customerId, customerIds))
    : [];
  return {
    orderCount: orderRows.length,
    operationCount: Number(opRows[0]?.count ?? 0),
    allocationCount: Number(allocRows[0]?.count ?? 0),
    consumptionCount: Number(consRows[0]?.count ?? 0),
    customerCount: customerIds.length,
    customerIds,
    invoices: invoiceRows,
  };
}

export async function GET() {
  const { error } = await requireManager();
  if (error) return error;
  try {
    const preview = await loadPreview();
    const { customerIds: _ids, ...rest } = preview;
    return NextResponse.json({ ...rest, confirmText: RESET_CONFIRM_TEXT });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Could not load the reset preview." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { user, error } = await requireManager();
  if (error || !user) return error!;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (String(body?.confirmText ?? "").trim() !== RESET_CONFIRM_TEXT) {
    return NextResponse.json({ error: `Type ${RESET_CONFIRM_TEXT} to confirm.` }, { status: 400 });
  }
  const deleteInvoices = body?.deleteInvoices === true;
  const deleteInventoryRecords = body?.deleteInventoryRecords !== false;

  try {
    const preview = await loadPreview();
    if (!deleteInventoryRecords && (preview.allocationCount > 0 || preview.consumptionCount > 0)) {
      return NextResponse.json(
        {
          error:
            `Cannot keep the inventory records: ${preview.allocationCount} allocation(s) and ${preview.consumptionCount} consumption record(s) exist. ` +
            "The database removes them together with their order, so choose to delete them.",
        },
        { status: 409 },
      );
    }

    const orderIds = (await db.select({ id: orders.id }).from(orders)).map((o) => o.id);
    const invoiceIds = deleteInvoices ? preview.invoices.map((i) => i.id) : [];

    await db.transaction(async (tx) => {
      if (invoiceIds.length > 0) {
        // Quotes converted from these invoices keep their row but lose the link.
        await tx.update(invoices).set({ convertedFromId: null }).where(inArray(invoices.convertedFromId, invoiceIds));
        await tx.delete(invoicePayments).where(inArray(invoicePayments.invoiceId, invoiceIds));
        await tx.delete(invoiceLines).where(inArray(invoiceLines.invoiceId, invoiceIds));
        await tx.delete(invoices).where(inArray(invoices.id, invoiceIds));
      }
      if (orderIds.length > 0) {
        // Children first: consumption rows reference steps; all three reference orders.
        await tx.delete(materialConsumptions);
        await tx.delete(orderMaterials);
        await tx.delete(orderOperations);
        await tx.delete(orders);
      }
    });

    const cleanupWarnings = clearAllOrderRuntimeState();
    if (cleanupWarnings.length > 0) {
      console.warn("Order reset completed with overlay cleanup warnings:", cleanupWarnings);
    }

    const summary =
      `Reset all orders: ${orderIds.length} order(s), ${preview.operationCount} step(s), ` +
      `${preview.allocationCount} allocation(s), ${preview.consumptionCount} consumption record(s), ` +
      `${invoiceIds.length} invoice(s) ${deleteInvoices ? "deleted" : "kept"}. Stock quantities unchanged.`;
    logAudit(user, "orders.reset_all", "order", summary);

    return NextResponse.json({
      success: true,
      deletedOrders: orderIds.length,
      deletedOperations: preview.operationCount,
      deletedAllocations: preview.allocationCount,
      deletedConsumptions: preview.consumptionCount,
      deletedInvoices: invoiceIds.length,
      keptInvoices: deleteInvoices ? 0 : preview.invoices.length,
      warnings: cleanupWarnings,
    });
  } catch (e: any) {
    console.error("Reset all orders error:", e);
    return NextResponse.json({ error: e?.cause?.message || e?.message || "Failed to reset orders." }, { status: 500 });
  }
}
