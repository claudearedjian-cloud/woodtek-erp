import { NextResponse } from "next/server";
import { db } from "@/db";
import { inventoryItems, materialConsumptions, orderMaterials } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { canSeeMoney } from "@/lib/optionalModules";
import { readOptionalModules } from "@/lib/optionalModules.server";
import { logAudit } from "@/lib/audit.server";
import { setInventoryDimension, deleteInventoryDimension, readInventoryDimensions } from "@/lib/inventoryDimensions.server";
import { normalizeDimensions, validateDimensions } from "@/lib/inventoryDimensions";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError, user } = await authorize("inventory:write");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { id } = await context.params;
    const body = await request.json();
    const money = canSeeMoney(user, readOptionalModules());
    if (body.unitCost !== undefined && !money) return NextResponse.json({ error: "Invoicing & Money access is required to change a material cost." }, { status: 403 });
    const itemId = Number(id);
    if (!Number.isSafeInteger(itemId) || itemId <= 0) return NextResponse.json({ error: "Invalid stock item id." }, { status: 400 });
    if (body.adjustQuantity !== undefined && body.stockQuantity !== undefined) return NextResponse.json({ error: "Use either an adjustment or an absolute quantity, not both." }, { status: 400 });
    const delta = body.adjustQuantity === undefined ? null : Number(body.adjustQuantity);
    if (delta !== null && (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 1_000_000)) return NextResponse.json({ error: "Stock adjustment must be a nonzero whole number up to 1,000,000." }, { status: 400 });

    const updateFields: any = {};
    if (body.name !== undefined) updateFields.name = body.name;
    if (body.sku !== undefined) updateFields.sku = body.sku.toUpperCase();
    if (body.category !== undefined) updateFields.category = body.category;
    if (body.stockQuantity !== undefined) {
      const quantity = Number(body.stockQuantity);
      if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 2_147_483_647) return NextResponse.json({ error: "Stock quantity must be a non-negative whole number." }, { status: 400 });
      updateFields.stockQuantity = quantity;
    }
    if (delta !== null) updateFields.stockQuantity = sql`${inventoryItems.stockQuantity} + ${delta}`;
    if (body.unit !== undefined) updateFields.unit = body.unit;
    if (body.unitCost !== undefined) updateFields.unitCost = String(body.unitCost);
    if (body.reorderLevel !== undefined) updateFields.reorderLevel = Number(body.reorderLevel);
    if (body.location !== undefined) updateFields.location = body.location;

    // Panel dimensions (JSON overlay): provided = update, "" = clear.
    let nextDimensions: string | null = null;
    if (body.dimensions !== undefined) {
      const dims = normalizeDimensions(body.dimensions);
      const dimensionsError = validateDimensions(dims);
      if (dimensionsError) {
        return NextResponse.json({ error: dimensionsError }, { status: 400 });
      }
      nextDimensions = dims || null;
    } else {
      nextDimensions = readInventoryDimensions()[String(id)] ?? null;
    }

    const condition = delta === null
      ? eq(inventoryItems.id, itemId)
      : and(eq(inventoryItems.id, itemId), sql`${inventoryItems.stockQuantity} >= ${-delta} and ${inventoryItems.stockQuantity} <= ${2_147_483_647 - delta}`);
    if (Object.keys(updateFields).length === 0 && body.dimensions === undefined) return NextResponse.json({ error: "No changes were provided." }, { status: 400 });
    const [updated] = Object.keys(updateFields).length === 0
      ? await db.select().from(inventoryItems).where(eq(inventoryItems.id, itemId))
      : await db.update(inventoryItems).set(updateFields).where(condition).returning();
    if (!updated) return NextResponse.json({ error: "Stock item not found or adjustment exceeds allowed quantity. Refresh and try again." }, { status: 409 });
    if (body.dimensions !== undefined) setInventoryDimension(itemId, nextDimensions ?? "");
    return NextResponse.json({ ...updated, unitCost: money ? updated.unitCost : null, dimensions: nextDimensions });
  } catch (error: any) {
    console.error("PATCH inventory error:", error);
    return NextResponse.json({ error: error?.message || "Failed to update item" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { user, error: authError } = await authorize("inventory:write");
  if (authError) return authError;

  try {
    const { id } = await context.params;
    // Consumption audit rows also reference the item (NOT NULL FK) - clean them first.
    await db.delete(materialConsumptions).where(eq(materialConsumptions.itemId, Number(id)));
    await db.delete(orderMaterials).where(eq(orderMaterials.itemId, Number(id)));
    await db.delete(inventoryItems).where(eq(inventoryItems.id, Number(id)));
    deleteInventoryDimension(Number(id));
    logAudit(user, "inventory.item.delete", "inventory", "Stock item deleted (with its allocations and consumption rows)", Number(id));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE inventory error:", error);
    const detail = error?.cause?.message || error?.message || "Failed to delete item";
    return NextResponse.json({ error: detail }, { status: 500 });
  }
}
