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
        employee_code text not null default '',
        department text not null default '',
        employment_status text not null default 'Active',
        nationality text not null default '',
        date_of_birth date,
        gender text not null default '',
        marital_status text not null default '',
        phone text not null default '',
        address text not null default '',
        id_number text not null default '',
        passport_number text not null default '',
        visa_number text not null default '',
        residency_number text not null default '',
        residency_expiry date,
        emergency_contact_name text not null default '',
        emergency_contact_phone text not null default '',
        blood_type text not null default '',
        religion text not null default '',
        social_security_number text not null default '',
        bank_name text not null default '',
        iban text not null default '',
        notes text not null default '',
        photo_file text not null default '',
        updated_by_id integer references users(id) on delete set null,
        updated_at timestamp not null default now()
      )
    `);
    // Existing PCs created the pay-profile table before the employee card
    // existed — add every newer column idempotently.
    await tx.execute(sql`
      alter table hr_employee_profiles
        add column if not exists employee_code text not null default '',
        add column if not exists department text not null default '',
        add column if not exists employment_status text not null default 'Active',
        add column if not exists nationality text not null default '',
        add column if not exists date_of_birth date,
        add column if not exists gender text not null default '',
        add column if not exists marital_status text not null default '',
        add column if not exists phone text not null default '',
        add column if not exists address text not null default '',
        add column if not exists id_number text not null default '',
        add column if not exists passport_number text not null default '',
        add column if not exists visa_number text not null default '',
        add column if not exists residency_number text not null default '',
        add column if not exists residency_expiry date,
        add column if not exists emergency_contact_name text not null default '',
        add column if not exists emergency_contact_phone text not null default '',
        add column if not exists notes text not null default '',
        add column if not exists photo_file text not null default '',
        add column if not exists blood_type text not null default '',
        add column if not exists religion text not null default '',
        add column if not exists social_security_number text not null default '',
        add column if not exists bank_name text not null default '',
        add column if not exists iban text not null default ''
    `);
    await tx.execute(sql`
      create table if not exists hr_employee_documents (
        id serial primary key,
        user_id integer not null references users(id) on delete cascade,
        doc_type text not null default 'Other',
        title text not null default '',
        file_name text not null,
        original_name text not null default '',
        mime text not null default '',
        size integer not null default 0,
        expiry_date date,
        uploaded_by_id integer references users(id) on delete set null,
        created_at timestamp not null default now()
      )
    `);
    await tx.execute(sql`create index if not exists hr_employee_documents_user_idx on hr_employee_documents (user_id)`);
    await tx.execute(sql`
      create table if not exists hr_salary_history (
        id serial primary key,
        user_id integer not null references users(id) on delete cascade,
        effective_date date not null,
        monthly_amount_cents integer not null default 0 check (monthly_amount_cents between 0 and 99999999),
        note text not null default '',
        created_by_id integer references users(id) on delete set null,
        created_at timestamp not null default now()
      )
    `);
    await tx.execute(sql`create index if not exists hr_salary_history_user_idx on hr_salary_history (user_id)`);
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
    // Overtime register (added with the working-calendar bundle). Created after
    // hr_payroll_runs because a paid entry points at the run that paid it.
    await tx.execute(sql`
      create table if not exists hr_overtime_entries (
        id serial primary key,
        user_id integer not null references users(id) on delete cascade,
        employee_name text not null default '',
        work_date date not null,
        day_kind text not null default 'Working' check (day_kind in ('Working', 'Holiday', 'Day off')),
        start_time text not null default '',
        end_time text not null default '',
        minutes integer not null check (minutes between 5 and 1440),
        base_rate_cents_per_hour integer not null default 0 check (base_rate_cents_per_hour between 0 and 99999999),
        multiplier_percent integer not null default 100 check (multiplier_percent between 100 and 1000),
        rate_cents_per_hour integer not null default 0 check (rate_cents_per_hour between 0 and 9999999),
        amount_cents integer not null default 0 check (amount_cents between 0 and 99999999),
        status text not null default 'Pending' check (status in ('Pending', 'Approved', 'Rejected')),
        notes text not null default '',
        payroll_run_id integer references hr_payroll_runs(id) on delete set null,
        reviewed_by_id integer references users(id) on delete set null,
        reviewed_at timestamp,
        created_by_id integer references users(id) on delete set null,
        created_at timestamp not null default now(),
        updated_at timestamp not null default now()
      )
    `);
    // PCs that created the table before the payroll link / review columns
    // existed keep working: add every newer column idempotently.
    await tx.execute(sql`
      alter table hr_overtime_entries
        add column if not exists employee_name text not null default '',
        add column if not exists day_kind text not null default 'Working',
        add column if not exists start_time text not null default '',
        add column if not exists end_time text not null default '',
        add column if not exists base_rate_cents_per_hour integer not null default 0,
        add column if not exists multiplier_percent integer not null default 100,
        add column if not exists payroll_run_id integer references hr_payroll_runs(id) on delete set null,
        add column if not exists reviewed_by_id integer references users(id) on delete set null,
        add column if not exists reviewed_at timestamp,
        add column if not exists updated_at timestamp not null default now()
    `);
    await tx.execute(sql`create index if not exists hr_overtime_entries_user_date_idx on hr_overtime_entries (user_id, work_date)`);
    await tx.execute(sql`create index if not exists hr_overtime_entries_work_date_idx on hr_overtime_entries (work_date)`);
    await tx.execute(sql`create index if not exists hr_overtime_entries_status_idx on hr_overtime_entries (status)`);
    await tx.execute(sql`create index if not exists hr_overtime_entries_payroll_run_idx on hr_overtime_entries (payroll_run_id)`);
  });
  ready = true;
}
