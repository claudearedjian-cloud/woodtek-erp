// ============================================================================
// Live-database schema check for the Wood & Edge Stock tables (SERVER ONLY).
//
// The owner's live PostgreSQL database predates the current schema: e.g. its
// material_consumptions table is missing the item_id column, which makes
// single-item deletes fail with "column material_consumptions.item_id does
// not exist". This module compares the live tables with the columns the app
// expects and can safely add any missing ones (ADD COLUMN IF NOT EXISTS,
// nullable, no new constraints) — it never drops or alters existing columns.
// Table/column identifiers below are hard-coded app constants, not user input.
// ============================================================================

import { db } from "@/db";
import { sql } from "drizzle-orm";

export interface InventorySchemaCheck {
  table: string;
  expected: string[];
  actual: string[];
  missing: string[];
  unexpected: string[];
  foreignKeys: Array<{ conname: string; def: string }>;
}

/** Columns the app expects (mirrors src/db/schema.ts). */
const EXPECTED_COLUMNS: Record<string, string[]> = {
  inventory_items: [
    "id", "sku", "name", "category", "stock_quantity", "unit", "unit_cost",
    "reorder_level", "location", "created_at",
  ],
  order_materials: [
    "id", "order_id", "item_id", "quantity_used", "cost_per_unit",
    "consumed", "consumed_at", "released", "released_at",
  ],
  material_consumptions: [
    "id", "order_id", "item_id", "quantity", "consumed_by", "operation_id",
    "notes", "consumed_at",
  ],
};

/** SQL types used when adding missing columns (nullable + default: safe on drifted data). */
const REPAIR_TYPES: Record<string, Record<string, string>> = {
  inventory_items: {
    sku: "text",
    name: "text",
    category: "text",
    stock_quantity: "integer DEFAULT 0",
    unit: "text DEFAULT 'sheets'",
    unit_cost: "numeric DEFAULT '0.00'",
    reorder_level: "integer DEFAULT 10",
    location: "text DEFAULT 'Rack 3-B'",
    created_at: "timestamp DEFAULT now()",
  },
  order_materials: {
    order_id: "integer",
    item_id: "integer",
    quantity_used: "integer DEFAULT 1",
    cost_per_unit: "numeric DEFAULT '0.00'",
    consumed: "boolean DEFAULT false",
    consumed_at: "timestamp",
    released: "boolean DEFAULT false",
    released_at: "timestamp",
  },
  material_consumptions: {
    order_id: "integer",
    item_id: "integer",
    quantity: "integer",
    consumed_by: "integer",
    operation_id: "integer",
    notes: "text",
    consumed_at: "timestamp DEFAULT now()",
  },
};

export async function checkInventorySchema(): Promise<InventorySchemaCheck[]> {
  const out: InventorySchemaCheck[] = [];
  for (const table of Object.keys(EXPECTED_COLUMNS)) {
    const { rows: cols } = (await db.execute(
      sql`select column_name from information_schema.columns where table_name = ${table} order by ordinal_position`,
    )) as { rows: Array<{ column_name: unknown }> };
    const actual = cols.map((r) => String(r.column_name));
    const expected = EXPECTED_COLUMNS[table];
    const missing = expected.filter((c) => !actual.includes(c));
    const unexpected = actual.filter((c) => !expected.includes(c));

    let foreignKeys: Array<{ conname: string; def: string }> = [];
    try {
      const { rows: fks } = (await db.execute(
        sql`select conname, pg_get_constraintdef(oid) as def from pg_constraint where contype = 'f' and confrelid = ${table}::regclass`,
      )) as { rows: Array<{ conname: unknown; def: unknown }> };
      foreignKeys = fks.map((r) => ({ conname: String(r.conname), def: String(r.def) }));
    } catch {
      /* FK introspection is best-effort */
    }

    out.push({ table, expected, actual, missing, unexpected, foreignKeys });
  }
  return out;
}

/** Add missing columns (idempotent). Returns the statements applied + the new check. */
export async function repairInventorySchema(): Promise<{
  applied: string[];
  after: InventorySchemaCheck[];
}> {
  const before = await checkInventorySchema();
  const applied: string[] = [];
  for (const t of before) {
    for (const col of t.missing) {
      const typeSql = REPAIR_TYPES[t.table]?.[col];
      if (!typeSql) continue; // only repair columns we know the type of
      const stmt = `ALTER TABLE ${t.table} ADD COLUMN IF NOT EXISTS ${col} ${typeSql}`;
      await db.execute(sql.raw(stmt));
      applied.push(stmt);
    }
  }
  const after = await checkInventorySchema();
  return { applied, after };
}
