// ============================================================================
// Delete ALL stock items in one shot (Manager only). Wipes the stock ledger
// rows that reference items (consumption audit rows + order material
// allocations) first, so the NOT NULL foreign keys cannot block the wipe.
// Also clears the dimensions overlay. Used to reset physical stock before a
// fresh Excel import.
// ============================================================================

import { NextResponse } from "next/server";
import { db } from "@/db";
import { inventoryItems, materialConsumptions, orderMaterials } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import { clearInventoryDimensions } from "@/lib/inventoryDimensions.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE() {
  const { user, error } = await authorize("users:manage");
  if (error) return error;

  try {
    const consumptions = await db.delete(materialConsumptions).returning({ id: materialConsumptions.id });
    const allocations = await db.delete(orderMaterials).returning({ id: orderMaterials.id });
    const items = await db.delete(inventoryItems).returning({ id: inventoryItems.id });
    clearInventoryDimensions();

    logAudit(user, "inventory.delete_all", "inventory", `Deleted all ${items.length} stock items, ${allocations.length} material allocations, ${consumptions.length} consumption records.`);
    return NextResponse.json({
      success: true,
      deletedItems: items.length,
      deletedAllocations: allocations.length,
      deletedConsumptions: consumptions.length,
    });
  } catch (e: unknown) {
    const causeMessage = (e as { cause?: unknown })?.cause;
    const detail =
      causeMessage instanceof Error
        ? `Failed to delete all stock items: ${causeMessage.message}`
        : e instanceof Error
          ? e.message
          : "Failed to delete all stock items";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
