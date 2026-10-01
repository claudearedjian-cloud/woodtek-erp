import { NextResponse } from "next/server";
import { db } from "@/db";
import { inventoryItems } from "@/db/schema";
import { asc } from "drizzle-orm";
import { authorize } from "@/lib/auth";
import { computeAvailability } from "@/lib/materials";
import { canSeeMoney } from "@/lib/optionalModules";
import { readOptionalModules } from "@/lib/optionalModules.server";
import { readInventoryDimensions, setInventoryDimension } from "@/lib/inventoryDimensions.server";
import { normalizeDimensions, validateDimensions } from "@/lib/inventoryDimensions";

export async function GET() {
  const { error: authError, user } = await authorize("inventory:read");
  if (authError) return authError;

  try {
    const items = await db.select().from(inventoryItems).orderBy(asc(inventoryItems.category), asc(inventoryItems.name));

    // Compute reservations so we can show available stock to operators
    // (and to managers - operators also need this for the Operator Station)
    const availability = await computeAvailability();

    // Panel dimensions live in the JSON overlay (no DB migration).
    const dimensions = readInventoryDimensions();

    // Unit costs follow the separate Invoicing & Money optional grant.
    const isPrivileged = canSeeMoney(user, readOptionalModules());

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
        dimensions: dimensions[String(it.id)] ?? null,
        // Redact costs when the money grant is absent.
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
  const { error: authError, user } = await authorize("inventory:write");
  if (authError || !user) return authError ?? NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const money = canSeeMoney(user, readOptionalModules());
    if (body.unitCost !== undefined && !money) return NextResponse.json({ error: "Invoicing & Money access is required to set a material cost." }, { status: 403 });
    const { sku, name, category = "Wood & MDF Panels", stockQuantity = 0, unit = "sheets", unitCost = "0.00", reorderLevel = 10, location = "Shop Storage" } = body;

    if (!sku || !name) {
      return NextResponse.json({ error: "SKU and Item Name are required." }, { status: 400 });
    }

    const dimensions = normalizeDimensions(body.dimensions);
    const dimensionsError = validateDimensions(dimensions);
    if (dimensionsError) {
      return NextResponse.json({ error: dimensionsError }, { status: 400 });
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

    if (dimensions) {
      setInventoryDimension(newItem.id, dimensions);
    }

    return NextResponse.json({ ...newItem, unitCost: money ? newItem.unitCost : null, dimensions: dimensions || null }, { status: 201 });
  } catch (error: any) {
    console.error("POST inventory error:", error);
    return NextResponse.json({ error: error?.message || "Failed to create inventory item" }, { status: 500 });
  }
}
