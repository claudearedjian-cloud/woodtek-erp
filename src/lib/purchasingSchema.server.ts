// Idempotent, additive purchasing schema setup. The factory does not run
// migrations during its Windows update ritual; opening the granted module
// creates only its five new tables/indexes. The advisory lock serializes
// simultaneous first requests; the transaction rolls back ALL DDL on failure.
// Keep column definitions in sync with src/db/schema.ts.
import { db } from "@/db";
import { sql } from "drizzle-orm";

let ready = false;

export async function ensurePurchasingSchema(): Promise<void> {
  if (ready) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(874221905)`);
    await tx.execute(sql`
      create table if not exists suppliers (
        id serial primary key,
        name text not null,
        contact_name text not null default '',
        phone text not null default '',
        email text not null default '',
        address text not null default '',
        notes text not null default '',
        active boolean not null default true,
        created_at timestamp not null default now()
      )
    `);
    await tx.execute(sql`create unique index if not exists suppliers_name_ci_idx on suppliers (lower(name))`);
    await tx.execute(sql`
      create table if not exists purchase_orders (
        id serial primary key,
        supplier_id integer not null references suppliers(id),
        created_by_id integer references users(id) on delete set null,
        expected_at date,
        notes text not null default '',
        status text not null default 'Open' check (status in ('Open', 'Closed', 'Cancelled')),
        created_at timestamp not null default now()
      )
    `);
    await tx.execute(sql`create index if not exists purchase_orders_supplier_status_idx on purchase_orders (supplier_id, status)`);
    await tx.execute(sql`create index if not exists purchase_orders_created_at_idx on purchase_orders (created_at)`);
    await tx.execute(sql`
      create table if not exists purchase_order_lines (
        id serial primary key,
        order_id integer not null references purchase_orders(id),
        item_id integer references inventory_items(id) on delete set null,
        item_sku text not null,
        item_name text not null,
        item_unit text not null,
        quantity integer not null check (quantity between 1 and 1000000),
        unit_price numeric(12,2) not null default 0.00 check (unit_price >= 0 and unit_price <= 999999.99)
      )
    `);
    await tx.execute(sql`create index if not exists purchase_order_lines_order_idx on purchase_order_lines (order_id)`);
    await tx.execute(sql`create index if not exists purchase_order_lines_item_idx on purchase_order_lines (item_id)`);
    await tx.execute(sql`
      create table if not exists goods_receipts (
        id serial primary key,
        order_id integer not null references purchase_orders(id),
        request_key text not null unique,
        received_by_id integer references users(id) on delete set null,
        delivery_ref text not null default '',
        notes text not null default '',
        received_at timestamp not null default now()
      )
    `);
    await tx.execute(sql`create index if not exists goods_receipts_order_idx on goods_receipts (order_id)`);
    await tx.execute(sql`
      create table if not exists goods_receipt_lines (
        id serial primary key,
        receipt_id integer not null references goods_receipts(id),
        po_line_id integer not null references purchase_order_lines(id),
        quantity integer not null check (quantity between 1 and 1000000)
      )
    `);
    await tx.execute(sql`create unique index if not exists goods_receipt_lines_unique_idx on goods_receipt_lines (receipt_id, po_line_id)`);
    await tx.execute(sql`create index if not exists goods_receipt_lines_po_line_idx on goods_receipt_lines (po_line_id)`);
  });
  ready = true;
}
