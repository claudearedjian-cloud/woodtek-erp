import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { inventoryItems } from "@/db/schema";
import { authorize } from "@/lib/auth";
import { logAudit } from "@/lib/audit.server";
import {
  INVENTORY_IMPORT_MAX_FILE_BYTES,
  type InventoryImportValidation,
  validateInventoryImportMatrix,
} from "@/lib/inventoryImport";
import {
  buildInventoryImportTemplate,
  InventoryWorkbookError,
  parseInventoryWorkbook,
} from "@/lib/inventoryImport.server";
import { effectiveInventoryCategories } from "@/lib/inventoryCategories.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "private, no-store, max-age=0" };

class ImportChangedError extends Error {
  constructor(readonly validation: InventoryImportValidation) {
    super("Stock changed after preview; validate the workbook again.");
    this.name = "ImportChangedError";
  }
}

export async function GET() {
  const { error } = await authorize("inventory:write");
  if (error) return error;

  try {
    const bytes = await buildInventoryImportTemplate();
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        ...NO_STORE_HEADERS,
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": 'attachment; filename="WoodTek-Stock-Import-Template.xlsx"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (cause) {
    console.error("Stock import template generation failed", cause);
    return NextResponse.json({ error: "Could not generate the Excel template." }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function POST(request: Request) {
  const { user, error } = await authorize("inventory:write");
  if (error) return error;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload the workbook as multipart form data." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const mode = String(form.get("mode") ?? "preview").trim().toLowerCase();
  if (mode !== "preview" && mode !== "commit") {
    return NextResponse.json({ error: "Import mode must be preview or commit." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const candidate = form.get("file");
  if (!candidate || typeof candidate !== "object" || !("arrayBuffer" in candidate) || !("size" in candidate)) {
    return NextResponse.json({ error: "Choose an .xlsx workbook to upload." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  const file = candidate as File;
  const fileName = String(file.name ?? "");
  if (!fileName.toLowerCase().endsWith(".xlsx")) {
    return NextResponse.json({ error: "Only .xlsx Excel workbooks are supported. Download the WoodTek template and save as .xlsx." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "The selected workbook is empty." }, { status: 400, headers: NO_STORE_HEADERS });
  }
  if (file.size > INVENTORY_IMPORT_MAX_FILE_BYTES) {
    return NextResponse.json({ error: "The workbook exceeds the 5 MB upload limit." }, { status: 413, headers: NO_STORE_HEADERS });
  }

  let matrix: unknown[][];
  try {
    matrix = await parseInventoryWorkbook(new Uint8Array(await file.arrayBuffer()));
  } catch (cause) {
    const message = cause instanceof InventoryWorkbookError
      ? cause.message
      : "The workbook could not be read. Download a fresh template and try again.";
    return NextResponse.json({ error: message }, { status: 422, headers: NO_STORE_HEADERS });
  }

  try {
    const initialExisting = await db.select({ id: inventoryItems.id, sku: inventoryItems.sku }).from(inventoryItems);
    // Categories are manager-editable — validate against the live list.
    const knownCategories = await effectiveInventoryCategories();
    const initialValidation = validateInventoryImportMatrix(matrix, initialExisting, knownCategories);
    if (mode === "preview") {
      return NextResponse.json(initialValidation, { headers: NO_STORE_HEADERS });
    }
    if (!initialValidation.valid) {
      return NextResponse.json(initialValidation, { status: 422, headers: NO_STORE_HEADERS });
    }

    const result = await db.transaction(async (tx) => {
      // Serialize imports and block every concurrent inventory INSERT/UPDATE for
      // this short transaction. The snapshot revalidation below therefore
      // remains true until every row has committed or the whole transaction rolls back.
      await tx.execute(sql`select pg_advisory_xact_lock(874221903)`);
      await tx.execute(sql`lock table inventory_items in share row exclusive mode`);

      const latestExisting = await tx.select({ id: inventoryItems.id, sku: inventoryItems.sku }).from(inventoryItems);
      const validation = validateInventoryImportMatrix(matrix, latestExisting, knownCategories);
      if (!validation.valid) throw new ImportChangedError(validation);

      let created = 0;
      let updated = 0;
      for (const row of validation.rows) {
        const values = {
          name: row.name,
          category: row.category,
          stockQuantity: row.stockQuantity,
          unit: row.unit,
          unitCost: row.unitCost,
          reorderLevel: row.reorderLevel,
          location: row.location,
        };
        if (row.action === "update" && row.existingId) {
          await tx.update(inventoryItems).set(values).where(eq(inventoryItems.id, row.existingId));
          updated += 1;
        } else {
          await tx.insert(inventoryItems).values({ sku: row.sku, ...values });
          created += 1;
        }
      }
      return { created, updated, total: validation.rows.length };
    });

    logAudit(
      user,
      "inventory.excel-import",
      "inventory",
      `Excel stock import: ${result.created} created, ${result.updated} updated (${result.total} total)`,
    );
    return NextResponse.json({ success: true, ...result }, { headers: NO_STORE_HEADERS });
  } catch (cause) {
    if (cause instanceof ImportChangedError) {
      return NextResponse.json(
        { ...cause.validation, error: cause.message },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    console.error("Atomic stock import failed", cause);
    return NextResponse.json(
      { error: "The workbook was not imported. Stock changed or the database rejected a row; zero rows were written. Preview it again and retry." },
      { status: 409, headers: NO_STORE_HEADERS },
    );
  }
}
