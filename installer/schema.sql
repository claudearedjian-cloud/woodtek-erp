-- ============================================================================
-- WoodTek ERP — Complete Idempotent Database Schema (PostgreSQL)
-- Used by WoodTek-ERP-Setup.exe (installer/bootstrap-db.cjs) to initialize or
-- upgrade a database on a brand-new PC without requiring drizzle-kit or TS.
-- Keep in sync with src/db/schema.ts.
-- ============================================================================

create table if not exists users (
  id serial primary key,
  name text not null,
  email text not null unique,
  role text not null,
  avatar_color text not null default 'bg-amber-600',
  pin text not null default '1234',
  active boolean not null default true,
  phone text,
  notes text,
  created_at timestamp not null default now()
);

create table if not exists reports (
  id serial primary key,
  name text not null,
  type text not null,
  generated_by integer references users(id),
  date_from timestamp not null,
  date_to timestamp not null,
  filters_json json,
  data_json json not null,
  created_at timestamp not null default now()
);

create table if not exists customers (
  id serial primary key,
  name text not null,
  company text not null,
  email text not null,
  phone text not null,
  address text not null,
  credit_limit numeric not null default '10000',
  current_balance numeric not null default '0',
  notes text,
  assigned_sales_id integer references users(id),
  created_at timestamp not null default now()
);
create index if not exists customers_assigned_sales_id_idx on customers (assigned_sales_id);

create table if not exists machines (
  id serial primary key,
  name text not null,
  code text not null unique,
  category text not null,
  status text not null default 'Active',
  hourly_cost numeric not null default '65.00',
  location text not null default 'Bay A - North Woodshop',
  maintenance_due timestamp,
  assigned_operator_id integer references users(id),
  notes text,
  created_at timestamp not null default now()
);
create index if not exists machines_category_idx on machines (category);

create table if not exists assets (
  id serial primary key,
  asset_tag text not null unique,
  name text not null,
  brand text not null default 'Generic',
  asset_type text not null default 'Generators',
  site text not null default 'Main Plant Bay A',
  machine_id integer references machines(id),
  runtime_hours integer not null default 0,
  service_interval_hours integer not null default 500,
  last_service_hours integer not null default 0,
  status text not null default 'Operational',
  criticality text not null default 'Medium',
  serial_number text,
  installed_at timestamp,
  notes text,
  series text,
  production_year integer,
  image_url text,
  power_status text not null default 'Standby',
  load_output_percent integer not null default 0,
  fuel_reserve_percent integer not null default 100,
  oil_pressure_bar numeric not null default '0.0',
  rating_kva integer not null default 0,
  telemetry_at timestamp,
  created_at timestamp not null default now()
);

create table if not exists cmms_settings (
  id serial primary key,
  setting_key text not null unique,
  setting_value json not null,
  updated_at timestamp not null default now()
);

create table if not exists maintenance_logs (
  id serial primary key,
  asset_id integer not null references assets(id) on delete cascade,
  event_type text not null default 'Inspection',
  description text not null,
  runtime_at_event integer not null default 0,
  downtime_minutes integer not null default 0,
  parts_cost numeric not null default '0.00',
  labor_cost numeric not null default '0.00',
  performed_by_id integer references users(id),
  reset_service boolean not null default false,
  checklist_json json,
  created_at timestamp not null default now()
);
create index if not exists maintenance_logs_asset_id_idx on maintenance_logs (asset_id);
create index if not exists maintenance_logs_created_at_idx on maintenance_logs (created_at);

create table if not exists operation_templates (
  id serial primary key,
  name text not null,
  description text not null,
  default_steps_json json not null,
  created_at timestamp not null default now()
);

create table if not exists orders (
  id serial primary key,
  order_number text not null unique,
  customer_id integer not null references customers(id),
  title text not null,
  project_type text not null,
  priority text not null default 'Normal',
  status text not null default 'In Production',
  total_value numeric not null default '0.00',
  due_date timestamp not null,
  progress_percent integer not null default 0,
  notes text,
  created_by_id integer references users(id),
  assigned_sales_id integer references users(id),
  materials_status text not null default 'unknown',
  created_at timestamp not null default now()
);
create index if not exists orders_customer_id_idx on orders (customer_id);
create index if not exists orders_status_idx on orders (status);
create index if not exists orders_assigned_sales_id_idx on orders (assigned_sales_id);
create index if not exists orders_created_by_id_idx on orders (created_by_id);
create index if not exists orders_due_date_idx on orders (due_date);
create index if not exists orders_created_at_idx on orders (created_at);

create table if not exists order_operations (
  id serial primary key,
  order_id integer not null references orders(id) on delete cascade,
  machine_id integer references machines(id),
  step_order integer not null,
  operation_name text not null,
  estimated_minutes integer not null default 45,
  actual_minutes integer not null default 0,
  status text not null default 'Pending',
  operator_id integer references users(id),
  start_time timestamp,
  end_time timestamp,
  scheduled_start timestamp,
  scheduled_end timestamp,
  quality_notes text,
  reject_reason text,
  updated_at timestamp not null default now()
);
create index if not exists order_operations_order_id_idx on order_operations (order_id);
create index if not exists order_operations_machine_id_idx on order_operations (machine_id);
create index if not exists order_operations_operator_id_idx on order_operations (operator_id);
create index if not exists order_operations_status_idx on order_operations (status);
create index if not exists order_operations_scheduled_start_idx on order_operations (scheduled_start);

create table if not exists inventory_items (
  id serial primary key,
  sku text not null unique,
  name text not null,
  category text not null,
  stock_quantity integer not null default 0,
  unit text not null default 'sheets',
  unit_cost numeric not null default '0.00',
  reorder_level integer not null default 10,
  location text not null default 'Rack 3-B',
  created_at timestamp not null default now()
);

create table if not exists order_materials (
  id serial primary key,
  order_id integer not null references orders(id) on delete cascade,
  item_id integer not null references inventory_items(id),
  quantity_used integer not null default 1,
  cost_per_unit numeric not null default '0.00',
  consumed boolean not null default false,
  consumed_at timestamp,
  released boolean not null default false,
  released_at timestamp
);
create index if not exists order_materials_order_id_idx on order_materials (order_id);
create index if not exists order_materials_item_id_idx on order_materials (item_id);

create table if not exists material_consumptions (
  id serial primary key,
  order_id integer not null references orders(id) on delete cascade,
  item_id integer not null references inventory_items(id),
  quantity integer not null,
  consumed_by integer references users(id),
  operation_id integer references order_operations(id),
  notes text,
  consumed_at timestamp not null default now()
);
create index if not exists material_consumptions_order_id_idx on material_consumptions (order_id);
create index if not exists material_consumptions_item_id_idx on material_consumptions (item_id);

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
);
create unique index if not exists suppliers_name_ci_idx on suppliers (lower(name));

create table if not exists purchase_orders (
  id serial primary key,
  supplier_id integer not null references suppliers(id),
  created_by_id integer references users(id) on delete set null,
  expected_at date,
  notes text not null default '',
  status text not null default 'Open' check (status in ('Open', 'Closed', 'Cancelled')),
  created_at timestamp not null default now()
);
create index if not exists purchase_orders_supplier_status_idx on purchase_orders (supplier_id, status);
create index if not exists purchase_orders_created_at_idx on purchase_orders (created_at);

create table if not exists purchase_order_lines (
  id serial primary key,
  order_id integer not null references purchase_orders(id),
  item_id integer references inventory_items(id) on delete set null,
  item_sku text not null,
  item_name text not null,
  item_unit text not null,
  quantity integer not null check (quantity between 1 and 1000000),
  unit_price numeric(12,2) not null default 0.00 check (unit_price >= 0 and unit_price <= 999999.99)
);
create index if not exists purchase_order_lines_order_idx on purchase_order_lines (order_id);
create index if not exists purchase_order_lines_item_idx on purchase_order_lines (item_id);

create table if not exists goods_receipts (
  id serial primary key,
  order_id integer not null references purchase_orders(id),
  request_key text not null unique,
  received_by_id integer references users(id) on delete set null,
  delivery_ref text not null default '',
  notes text not null default '',
  received_at timestamp not null default now()
);
create index if not exists goods_receipts_order_idx on goods_receipts (order_id);

create table if not exists goods_receipt_lines (
  id serial primary key,
  receipt_id integer not null references goods_receipts(id),
  po_line_id integer not null references purchase_order_lines(id),
  quantity integer not null check (quantity between 1 and 1000000)
);
create unique index if not exists goods_receipt_lines_unique_idx on goods_receipt_lines (receipt_id, po_line_id);
create index if not exists goods_receipt_lines_po_line_idx on goods_receipt_lines (po_line_id);

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
);
create unique index if not exists supplier_bills_supplier_ref_ci_idx
  on supplier_bills (supplier_id, lower(reference)) where status = 'Open';
create index if not exists supplier_bills_supplier_status_idx on supplier_bills (supplier_id, status);
create index if not exists supplier_bills_due_status_idx on supplier_bills (due_date, status);
create index if not exists supplier_bills_purchase_order_idx on supplier_bills (purchase_order_id);

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
);
create index if not exists supplier_bill_payments_bill_idx on supplier_bill_payments (bill_id);
create index if not exists supplier_bill_payments_paid_at_idx on supplier_bill_payments (paid_at);

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
);
create index if not exists invoices_customer_kind_status_idx on invoices (customer_id, kind, status);
create index if not exists invoices_issue_date_idx on invoices (issue_date);
create index if not exists invoices_due_date_idx on invoices (due_date);

create table if not exists invoice_lines (
  id serial primary key,
  invoice_id integer not null references invoices(id),
  inventory_item_id integer references inventory_items(id) on delete set null,
  description text not null,
  quantity numeric(12,2) not null default 1.00 check (quantity > 0),
  unit_price_cents integer not null default 0 check (unit_price_cents >= 0),
  line_total_cents integer not null default 0 check (line_total_cents >= 0)
);
alter table invoice_lines add column if not exists inventory_item_id integer references inventory_items(id) on delete set null;
create index if not exists invoice_lines_invoice_idx on invoice_lines (invoice_id);
create index if not exists invoice_lines_inventory_item_idx on invoice_lines (inventory_item_id);

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
);
create index if not exists payments_invoice_idx on payments (invoice_id);
create index if not exists payments_paid_at_idx on payments (paid_at);

create table if not exists document_counters (
  series text not null,
  year integer not null,
  last_number integer not null default 0,
  primary key (series, year)
);

create table if not exists shifts (
  id serial primary key,
  name text not null,
  start_time text not null default '06:00',
  end_time text not null default '14:00',
  color text not null default 'bg-amber-500',
  active boolean not null default true,
  created_at timestamp not null default now()
);

create table if not exists shift_assignments (
  id serial primary key,
  user_id integer not null references users(id) on delete cascade,
  shift_id integer not null references shifts(id),
  work_date date not null,
  machine_id integer references machines(id),
  notes text,
  created_at timestamp not null default now()
);
create index if not exists shift_assignments_work_date_user_id_idx on shift_assignments (work_date, user_id);

create table if not exists attendance (
  id serial primary key,
  user_id integer not null references users(id) on delete cascade,
  shift_id integer references shifts(id),
  clock_in timestamp not null default now(),
  clock_out timestamp,
  status text not null default 'Present',
  notes text,
  created_at timestamp not null default now()
);
create index if not exists attendance_user_id_idx on attendance (user_id);
create index if not exists attendance_clock_in_idx on attendance (clock_in);

-- HR & Payroll (also created lazily on the first granted HR request).
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
  notes text not null default '',
  photo_file text not null default '',
  updated_by_id integer references users(id) on delete set null,
  updated_at timestamp not null default now()
);
-- PCs installed before the employee card existed: backfill the newer columns.
alter table hr_employee_profiles add column if not exists employee_code text not null default '';
alter table hr_employee_profiles add column if not exists department text not null default '';
alter table hr_employee_profiles add column if not exists employment_status text not null default 'Active';
alter table hr_employee_profiles add column if not exists nationality text not null default '';
alter table hr_employee_profiles add column if not exists date_of_birth date;
alter table hr_employee_profiles add column if not exists gender text not null default '';
alter table hr_employee_profiles add column if not exists marital_status text not null default '';
alter table hr_employee_profiles add column if not exists phone text not null default '';
alter table hr_employee_profiles add column if not exists address text not null default '';
alter table hr_employee_profiles add column if not exists id_number text not null default '';
alter table hr_employee_profiles add column if not exists passport_number text not null default '';
alter table hr_employee_profiles add column if not exists visa_number text not null default '';
alter table hr_employee_profiles add column if not exists residency_number text not null default '';
alter table hr_employee_profiles add column if not exists residency_expiry date;
alter table hr_employee_profiles add column if not exists emergency_contact_name text not null default '';
alter table hr_employee_profiles add column if not exists emergency_contact_phone text not null default '';
alter table hr_employee_profiles add column if not exists notes text not null default '';
alter table hr_employee_profiles add column if not exists photo_file text not null default '';

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
);
create index if not exists hr_employee_documents_user_idx on hr_employee_documents (user_id);

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
);
create index if not exists hr_leave_requests_user_dates_idx on hr_leave_requests (user_id, start_date, end_date);
create index if not exists hr_leave_requests_status_idx on hr_leave_requests (status);

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
);

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
);
create index if not exists hr_payroll_items_run_idx on hr_payroll_items (run_id);

create table if not exists quality_events (
  id serial primary key,
  order_id integer not null references orders(id) on delete cascade,
  operation_id integer references order_operations(id) on delete set null,
  machine_id integer references machines(id) on delete set null,
  event_type text not null,
  quantity integer not null default 1,
  unit text not null default 'pcs',
  reason text not null,
  disposition text not null default 'Open',
  estimated_cost numeric not null default '0.00',
  recorded_by_id integer references users(id),
  notes text,
  created_at timestamp not null default now(),
  resolved_at timestamp
);
create index if not exists quality_events_order_id_idx on quality_events (order_id);
create index if not exists quality_events_machine_id_idx on quality_events (machine_id);

create table if not exists downtime_events (
  id serial primary key,
  machine_id integer not null references machines(id) on delete cascade,
  order_id integer references orders(id) on delete set null,
  operation_id integer references order_operations(id) on delete set null,
  reason text not null,
  started_at timestamp not null default now(),
  ended_at timestamp,
  duration_minutes integer not null default 0,
  operator_id integer references users(id),
  notes text,
  created_at timestamp not null default now()
);
create index if not exists downtime_events_machine_id_idx on downtime_events (machine_id);
create index if not exists downtime_events_started_at_idx on downtime_events (started_at);

create table if not exists pims_settings (
  id serial primary key,
  setting_key text not null unique,
  setting_value json not null,
  updated_at timestamp not null default now()
);

create table if not exists pims_imports (
  id serial primary key,
  file_name text not null,
  invoice_number text not null unique,
  customer_name text,
  order_id integer references orders(id) on delete set null,
  status text not null default 'imported',
  message text,
  raw_xml text,
  imported_at timestamp not null default now()
);
create index if not exists pims_imports_imported_at_idx on pims_imports (imported_at);
