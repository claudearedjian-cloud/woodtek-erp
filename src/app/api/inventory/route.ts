import { NextResponse } from "next/server";
import { db } from "@/db";
import { inventoryItems } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { computeAvailability } from "@/lib/materials";
import { getSessionUser } from "@/lib/auth";
import { isManager } from "@/lib/dataAccess";

export async function GET() {
  const { error: authError, user } = await authorize("inventory:read");
  if (authError) return authError;

  try {
    const items = await db.select().from(inventoryItems).orderBy(asc(inventoryItems.category), asc(inventoryItems.name));

    // Compute reservations so we can show available stock to operators
    // (and to managers - operators also need this for the Operator Station)
    const availability = await computeAvailability();

    // Field-level redaction: hide unitCost from non-Managers
    const isPrivileged = user ? isManager(user) : false;

    const enriched = items.map((it) => {
      const av = availability.get(it.id) || {
        stockQuantity: Number(it.stockQuantity) || 0,
        reserved: 0,
        available: Number(it.stockQuantity) || 0,
      };
      return {
        ...it,
        reservedQuantity: av.reserved,
        availableQuantity: av.available,
        // Redact financial fields for non-Managers
        unitCost: isPrivileged ? it.unitCost : null,
      };
    });

    return NextResponse.json(enriched);
  } catch (error: any) {
    console.error("GET inventory error:", error);
    return NextResponse.json({ error: error?.message || "Failed to fetch inventory" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const { error: authError } = await authorize("inventory:write");
  if (authError) return authError;

  try {
    const body = await request.json();
    const { sku, name, category = "Wood & MDF Panels", stockQuantity = 0, unit = "sheets", unitCost = "0.00", reorderLevel = 10, location = "Shop Storage" } = body;

    if (!sku || !name) {
      return NextResponse.json({ error: "SKU and Item Name are required." }, { status: 400 });
    }

    const [newItem] = await db.insert(inventoryItems).values({
      sku: sku.toUpperCase(),
      name,
      category,
      stockQuantity: Number(stockQuantity),
      unit,
      unitCost: String(unitCost),
      reorderLevel: Number(reorderLevel),
      location,
    }).returning();

    return NextResponse.json(newItem, { status: 201 });
  } catch (error: any) {
    console.error("POST inventory error:", error);
    return NextResponse.json({ error: error?.message || "Failed to create inventory item" }, { status: 500 });
  }
}
