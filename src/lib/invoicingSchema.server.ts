// Idempotent, additive invoicing schema setup. Same ritual as purchasing: the
// factory does not run migrations during its Windows update ritual, so opening
// the granted module creates only its four new tables/indexes. The advisory
// lock serializes simultaneous first requests; the transaction rolls back ALL
// DDL on failure. The line stock-picker follow-up adds one nullable column and
// one index on the existing invoice_lines table — existing rows and their
// description snapshots are preserved untouched. Keep column definitions in
// sync with src/db/schema.ts.
import { db } from "@/db";
import { sql } from "drizzle-orm";

let ready = false;

export async function ensureInvoicingSchema(): Promise<void> {
  if (ready) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(874221906)`);
    await tx.execute(sql`
      create table if not exists invoices (
        id serial primary key,
        kind text not null default 'Invoice' check (kind in ('Quote', 'Invoice')),
        number text not null unique,
        customer_id integer references customers(id) on delete set null,
        customer_name text not null,
        customer_company text not null default '',
        issue_date date not null,
        due_date date,
        status text not null default 'Open' check (status in ('Open', 'Converted', 'Cancelled')),
        vat_rate numeric(5,2) not null default 11.00 check (vat_rate >= 0 and vat_rate <= 100),
        subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
        vat_cents integer not null default 0 check (vat_cents >= 0),
        total_cents integer not null default 0 check (total_cents >= 0),
        notes text not null default '',
        converted_from_id integer references invoices(id),
        created_by_id integer references users(id) on delete set null,
        created_at timestamp not null default now()
      )
    `);
    await tx.execute(sql`create index if not exists invoices_customer_kind_status_idx on invoices (customer_id, kind, status)`);
    await tx.execute(sql`create index if not exists invoices_issue_date_idx on invoices (issue_date)`);
    await tx.execute(sql`create index if not exists invoices_due_date_idx on invoices (due_date)`);
    await tx.execute(sql`
      create table if not exists invoice_lines (
        id serial primary key,
        invoice_id integer not null references invoices(id),
        inventory_item_id integer references inventory_items(id) on delete set null,
        description text not null,
        quantity numeric(12,2) not null default 1.00 check (quantity > 0),
        unit_price_cents integer not null default 0 check (unit_price_cents >= 0),
        line_total_cents integer not null default 0 check (line_total_cents >= 0)
      )
    `);
    // Stock-picker follow-up for installations that already have the table:
    // null for every historical line, so existing snapshots stay authoritative.
    await tx.execute(sql`alter table invoice_lines add column if not exists inventory_item_id integer references inventory_items(id) on delete set null`);
    await tx.execute(sql`create index if not exists invoice_lines_invoice_idx on invoice_lines (invoice_id)`);
    await tx.execute(sql`create index if not exists invoice_lines_inventory_item_idx on invoice_lines (inventory_item_id)`);
    await tx.execute(sql`
      create table if not exists payments (
        id serial primary key,
        invoice_id integer not null references invoices(id),
        amount_cents integer not null check (amount_cents > 0),
        paid_at date not null,
        method text not null default 'Cash' check (method in ('Cash', 'Transfer', 'Check', 'Other')),
        reference text not null default '',
        notes text not null default '',
        recorded_by_id integer references users(id) on delete set null,
        created_at timestamp not null default now()
      )
    `);
    await tx.execute(sql`create index if not exists payments_invoice_idx on payments (invoice_id)`);
    await tx.execute(sql`create index if not exists payments_paid_at_idx on payments (paid_at)`);
    await tx.execute(sql`
      create table if not exists document_counters (
        series text not null,
        year integer not null,
        last_number integer not null default 0,
        primary key (series, year)
      )
    `);
  });
  ready = true;
}
