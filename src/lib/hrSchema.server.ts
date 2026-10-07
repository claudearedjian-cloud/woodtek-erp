// Lazy, additive HR/payroll schema. The installer creates the same tables for a
// fresh PC, while existing installations create them on the first granted HR
// request. One advisory lock keeps simultaneous first visits race-safe.
import { db } from "@/db";
import { sql } from "drizzle-orm";

let ready = false;

export async function ensureHrSchema(): Promise<void> {
  if (ready) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(874221908)`);
    await tx.execute(sql`
      create table if not exists hr_employee_profiles (
        id serial primary key,
        user_id integer not null unique references users(id) on delete cascade,
        job_title text not null default '',
        hire_date date,
        base_salary_cents integer not null default 0 check (base_salary_cents between 0 and 99999999),
        updated_by_id integer references users(id) on delete set null,
        updated_at timestamp not null default now()
      )
    `);
    await tx.execute(sql`
      create table if not exists hr_leave_requests (
        id serial primary key,
        user_id integer references users(id) on delete set null,
        employee_name text not null,
        role_snapshot text not null default '',
        leave_type text not null check (leave_type in ('Annual', 'Sick', 'Unpaid', 'Other')),
        start_date date not null,
        end_date date not null,
        days integer not null check (days between 1 and 366),
        reason text not null default '',
        status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Declined')),
        reviewed_by_id integer references users(id) on delete set null,
        review_note text not null default '',
        reviewed_at timestamp,
        created_by_id integer references users(id) on delete set null,
        created_at timestamp not null default now(),
        check (end_date >= start_date)
      )
    `);
    await tx.execute(sql`create index if not exists hr_leave_requests_user_dates_idx on hr_leave_requests (user_id, start_date, end_date)`);
    await tx.execute(sql`create index if not exists hr_leave_requests_status_idx on hr_leave_requests (status)`);
    await tx.execute(sql`
      create table if not exists hr_payroll_runs (
        id serial primary key,
        period_year integer not null check (period_year between 2000 and 2200),
        period_month integer not null check (period_month between 1 and 12),
        status text not null default 'Draft' check (status in ('Draft', 'Posted')),
        created_by_id integer references users(id) on delete set null,
        posted_by_id integer references users(id) on delete set null,
        posted_at timestamp,
        created_at timestamp not null default now(),
        unique (period_year, period_month)
      )
    `);
    await tx.execute(sql`
      create table if not exists hr_payroll_items (
        id serial primary key,
        run_id integer not null references hr_payroll_runs(id) on delete cascade,
        user_id integer references users(id) on delete set null,
        employee_name text not null,
        role_snapshot text not null default '',
        base_salary_cents integer not null check (base_salary_cents between 0 and 99999999),
        additions_json json not null default '[]'::json,
        deductions_json json not null default '[]'::json,
        net_pay_cents integer not null check (net_pay_cents between 0 and 99999999),
        created_at timestamp not null default now(),
        unique (run_id, user_id)
      )
    `);
    await tx.execute(sql`create index if not exists hr_payroll_items_run_idx on hr_payroll_items (run_id)`);
  });
  ready = true;
}
