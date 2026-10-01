// Idempotent, additive schema for supplier bills, payments and A/P aging.
// Purchasing has to exist first because bills reference its supplier/PO tables.
// This is lazy factory-PC setup: a dedicated advisory lock serializes first
// access and the transaction rolls back every new table/index on failure.
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { ensurePurchasingSchema } from "@/lib/purchasingSchema.server";

let ready = false;

export async function ensurePayablesSchema(): Promise<void> {
  if (ready) return;
  await ensurePurchasingSchema();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(874221907)`);
    await tx.execute(sql`
      create table if not exists supplier_bills (
        id serial primary key,
        supplier_id integer not null references suppliers(id),
        purchase_order_id integer references purchase_orders(id) on delete set null,
        reference text not null,
        issue_date date not null,
        due_date date,
        total_cents integer not null check (total_cents between 1 and 99999999),
        notes text not null default '',
        status text not null default 'Open' check (status in ('Open', 'Cancelled')),
        cancelled_at timestamp,
        cancelled_by_id integer references users(id) on delete set null,
        cancel_reason text not null default '',
        created_by_id integer references users(id) on delete set null,
        created_at timestamp not null default now()
      )
    `);
    // Supplier invoice references are unique per supplier while active; a
    // cancelled typo can be corrected and re-entered with the same reference.
    await tx.execute(sql`
      create unique index if not exists supplier_bills_supplier_ref_ci_idx
      on supplier_bills (supplier_id, lower(reference)) where status = 'Open'
    `);
    await tx.execute(sql`create index if not exists supplier_bills_supplier_status_idx on supplier_bills (supplier_id, status)`);
    await tx.execute(sql`create index if not exists supplier_bills_due_status_idx on supplier_bills (due_date, status)`);
    await tx.execute(sql`create index if not exists supplier_bills_purchase_order_idx on supplier_bills (purchase_order_id)`);
    await tx.execute(sql`
      create table if not exists supplier_bill_payments (
        id serial primary key,
        bill_id integer not null references supplier_bills(id),
        request_key text not null unique,
        amount_cents integer not null check (amount_cents between 1 and 99999999),
        paid_at date not null,
        method text not null default 'Transfer' check (method in ('Cash', 'Transfer', 'Check', 'Other')),
        reference text not null default '',
        notes text not null default '',
        status text not null default 'Posted' check (status in ('Posted', 'Voided')),
        voided_at timestamp,
        voided_by_id integer references users(id) on delete set null,
        void_reason text not null default '',
        recorded_by_id integer references users(id) on delete set null,
        created_at timestamp not null default now()
      )
    `);
    await tx.execute(sql`create index if not exists supplier_bill_payments_bill_idx on supplier_bill_payments (bill_id)`);
    await tx.execute(sql`create index if not exists supplier_bill_payments_paid_at_idx on supplier_bill_payments (paid_at)`);
  });
  ready = true;
}
