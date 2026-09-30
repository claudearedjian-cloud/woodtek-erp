// ============================================================================
// Database index plan — pure helpers (client-safe, no node imports).
//
// The live WoodTek database has 21 tables, 32 foreign-key relationships and
// (until 2026-09-30) ZERO indexes beyond primary keys / unique constraints —
// every scoped list query (orders per customer, operations per machine,
// attendance per user, downtime per date window …) ran a sequential scan.
// Fine at factory scale today, slower every month as attendance, downtime,
// operations and audit rows accumulate.
//
// Deployment follows the no-migrations rule (same channel the inventory
// schema repair uses, bundle 40f): the Manager clicks "Create missing
// indexes" in Wood & Edge Stock → Schema Check and the app runs one
// idempotent `CREATE INDEX IF NOT EXISTS` per definition below. The same
// indexes are ALSO declared in src/db/schema.ts so a fresh `drizzle-kit
// push` install creates them automatically. Identifiers here are hard-coded
// app constants — never built from user input.
// ============================================================================

export interface DbIndexDef {
  /** Postgres index name — also the idempotency key for IF NOT EXISTS. */
  name: string;
  /** Table the index lives on (snake_case, as in the database). */
  table: string;
  /** Indexed column(s), in order (snake_case). >1 column = composite. */
  columns: string[];
  /** One-line reason — shown in the Schema Check dialog. */
  why: string;
}

/** Every index the app wants on the live database. */
export const DB_INDEX_PLAN: DbIndexDef[] = [
  // ---- orders ------------------------------------------------------------
  { name: "orders_customer_id_idx", table: "orders", columns: ["customer_id"], why: "Order lists join their customer on every screen" },
  { name: "orders_status_idx", table: "orders", columns: ["status"], why: "Status filters, kanban columns, QA & dashboard counts" },
  { name: "orders_assigned_sales_id_idx", table: "orders", columns: ["assigned_sales_id"], why: "Sales Coordinator order scoping" },
  { name: "orders_created_by_id_idx", table: "orders", columns: ["created_by_id"], why: "Sales Coordinator order scoping" },
  { name: "orders_due_date_idx", table: "orders", columns: ["due_date"], why: "Due-date risk panel, digest, Gantt" },
  { name: "orders_created_at_idx", table: "orders", columns: ["created_at"], why: "Recent-orders sorting and report windows" },
  // ---- order_operations --------------------------------------------------
  { name: "order_operations_order_id_idx", table: "order_operations", columns: ["order_id"], why: "Routing steps per order — the hottest join in the app" },
  { name: "order_operations_machine_id_idx", table: "order_operations", columns: ["machine_id"], why: "Station queues, operator scoping, pick-freest-machine" },
  { name: "order_operations_operator_id_idx", table: "order_operations", columns: ["operator_id"], why: "Operator order scoping + rankings" },
  { name: "order_operations_status_idx", table: "order_operations", columns: ["status"], why: "Claimable/overdue scans, planner, WIP board" },
  { name: "order_operations_scheduled_start_idx", table: "order_operations", columns: ["scheduled_start"], why: "Overdue detection + auto-planner window queries" },
  // ---- order_materials ---------------------------------------------------
  { name: "order_materials_order_id_idx", table: "order_materials", columns: ["order_id"], why: "BOM lines per order (order detail, warehouse board)" },
  { name: "order_materials_item_id_idx", table: "order_materials", columns: ["item_id"], why: "Reservations per material + the per-material Orders dialog" },
  // ---- material_consumptions --------------------------------------------
  { name: "material_consumptions_order_id_idx", table: "material_consumptions", columns: ["order_id"], why: "Consumption history per order / undo" },
  { name: "material_consumptions_item_id_idx", table: "material_consumptions", columns: ["item_id"], why: "Scoped deletes + consumption history per material" },
  // ---- quality_events ----------------------------------------------------
  { name: "quality_events_order_id_idx", table: "quality_events", columns: ["order_id"], why: "Scrap & rework per order" },
  { name: "quality_events_machine_id_idx", table: "quality_events", columns: ["machine_id"], why: "Scrap Pareto per machine" },
  // ---- downtime_events ---------------------------------------------------
  { name: "downtime_events_machine_id_idx", table: "downtime_events", columns: ["machine_id"], why: "Downtime log per machine, OEE" },
  { name: "downtime_events_started_at_idx", table: "downtime_events", columns: ["started_at"], why: "Plant performance / OEE date windows" },
  // ---- attendance --------------------------------------------------------
  { name: "attendance_user_id_idx", table: "attendance", columns: ["user_id"], why: "Today's-attendance strip polled by every view" },
  { name: "attendance_clock_in_idx", table: "attendance", columns: ["clock_in"], why: "Attendance date ranges in workforce reports" },
  // ---- shift_assignments -------------------------------------------------
  { name: "shift_assignments_work_date_user_id_idx", table: "shift_assignments", columns: ["work_date", "user_id"], why: "Shift plan per day (and per person on that day)" },
  // ---- maintenance_logs --------------------------------------------------
  { name: "maintenance_logs_asset_id_idx", table: "maintenance_logs", columns: ["asset_id"], why: "CMMS asset timeline" },
  { name: "maintenance_logs_created_at_idx", table: "maintenance_logs", columns: ["created_at"], why: "CMMS report windows" },
  // ---- customers ---------------------------------------------------------
  { name: "customers_assigned_sales_id_idx", table: "customers", columns: ["assigned_sales_id"], why: "Sales Coordinator customer scoping" },
  // ---- machines ----------------------------------------------------------
  { name: "machines_category_idx", table: "machines", columns: ["category"], why: "Category filters + auto-assign candidate lookup" },
  // ---- pims_imports ------------------------------------------------------
  { name: "pims_imports_imported_at_idx", table: "pims_imports", columns: ["imported_at"], why: "Import history ordering" },
];

/**
 * The exact statement the repair channel runs. Plain CREATE INDEX (not
 * CONCURRENTLY) inside one transaction: the factory database is small, so
 * each index builds in milliseconds and the lock is irrelevant.
 */
export function createIndexSql(def: DbIndexDef): string {
  const cols = def.columns.map((c) => `"${c}"`).join(", ");
  return `CREATE INDEX IF NOT EXISTS "${def.name}" ON "${def.table}" (${cols})`;
}

/**
 * Which plan indexes are missing, given the live index names from
 * pg_indexes (case-insensitive — Postgres folds unquoted names to lower
 * case, but tolerate anything).
 */
export function missingDbIndexes(liveIndexNames: readonly string[]): DbIndexDef[] {
  const live = new Set(liveIndexNames.map((n) => String(n ?? "").trim().toLowerCase()).filter(Boolean));
  return DB_INDEX_PLAN.filter((def) => !live.has(def.name.toLowerCase()));
}

/** Small UI summary: index count per table, plan order preserved. */
export function dbIndexPlanByTable(): Array<{ table: string; indexes: DbIndexDef[] }> {
  const out: Array<{ table: string; indexes: DbIndexDef[] }> = [];
  for (const def of DB_INDEX_PLAN) {
    let entry = out.find((t) => t.table === def.table);
    if (!entry) {
      entry = { table: def.table, indexes: [] };
      out.push(entry);
    }
    entry.indexes.push(def);
  }
  return out;
}
