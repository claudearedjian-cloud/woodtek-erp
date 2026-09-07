import { NextResponse } from "next/server";
import { db } from "@/db";
import { inventoryItems, orderMaterials } from "@/db/schema";
import { eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("inventory:write");
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const updateFields: any = {};
    if (body.name !== undefined) updateFields.name = body.name;
    if (body.sku !== undefined) updateFields.sku = body.sku.toUpperCase();
    if (body.category !== undefined) updateFields.category = body.category;
    if (body.stockQuantity !== undefined) updateFields.stockQuantity = Number(body.stockQuantity);
    if (body.unit !== undefined) updateFields.unit = body.unit;
    if (body.unitCost !== undefined) updateFields.unitCost = String(body.unitCost);
    if (body.reorderLevel !== undefined) updateFields.reorderLevel = Number(body.reorderLevel);
    if (body.location !== undefined) updateFields.location = body.location;

    const [updated] = await db.update(inventoryItems).set(updateFields).where(eq(inventoryItems.id, Number(id))).returning();
    return NextResponse.json(updated);
  } catch (error: any) {
    console.error("PATCH inventory error:", error);
    return NextResponse.json({ error: error?.message || "Failed to update item" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const { error: authError } = await authorize("inventory:write");
  if (authError) return authError;

  try {
    const { id } = await context.params;
    await db.delete(orderMaterials).where(eq(orderMaterials.itemId, Number(id)));
    await db.delete(inventoryItems).where(eq(inventoryItems.id, Number(id)));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error("DELETE inventory error:", error);
    return NextResponse.json({ error: error?.message || "Failed to delete item" }, { status: 500 });
  }
}
