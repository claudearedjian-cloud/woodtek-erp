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
  /** Extra columns that are NOT NULL without a default — they break app inserts. */
  blocking: string[];
  /** True when the id column has no default (inserts using DEFAULT will fail). */
  idHasDefault: boolean;
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
      sql`select column_name, is_nullable, column_default
          from information_schema.columns
          where table_name = ${table} order by ordinal_position`,
    )) as {
      rows: Array<{ column_name: unknown; is_nullable: unknown; column_default: unknown }>;
    };
    const actual = cols.map((r) => String(r.column_name));
    const expected = EXPECTED_COLUMNS[table];
    const missing = expected.filter((c) => !actual.includes(c));
    const unexpected = actual.filter((c) => !expected.includes(c));
    // Extra columns that are NOT NULL with no default break the app's inserts
    // (the insert only sets the app's columns; everything else becomes NULL).
    const blocking = cols
      .filter(
        (r) =>
          !expected.includes(String(r.column_name)) &&
          String(r.is_nullable) === "NO" &&
          r.column_default == null,
      )
      .map((r) => String(r.column_name));
    const idRow = cols.find((r) => String(r.column_name) === "id");
    const idHasDefault = idRow != null && idRow.column_default != null;

    let foreignKeys: Array<{ conname: string; def: string }> = [];
    try {
      const { rows: fks } = (await db.execute(
        sql`select conname, pg_get_constraintdef(oid) as def from pg_constraint where contype = 'f' and confrelid = ${table}::regclass`,
      )) as { rows: Array<{ conname: unknown; def: unknown }> };
      foreignKeys = fks.map((r) => ({ conname: String(r.conname), def: String(r.def) }));
    } catch {
      /* FK introspection is best-effort */
    }

    out.push({ table, expected, actual, missing, unexpected, blocking, idHasDefault, foreignKeys });
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
    // Relax NOT NULL on extra (legacy) columns so app inserts can omit them.
    for (const col of t.blocking) {
      const stmt = `ALTER TABLE ${t.table} ALTER COLUMN ${col} DROP NOT NULL`;
      await db.execute(sql.raw(stmt));
      applied.push(stmt);
    }
  }
  const after = await checkInventorySchema();
  return { applied, after };
}
