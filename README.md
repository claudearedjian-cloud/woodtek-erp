# WoodTek ERP — Furniture Service Center

Next.js 16 (standalone) + PostgreSQL shop-floor ERP.

## Layout
- `src/` — app source (single source of truth)
- `start-prod.cjs` — watchdog launcher (auto-restart, health probe, port-conflict handling)
- `start-woodtek-prod.bat` — interactive launcher (double-click)
- `start-woodtek-prod-silent.bat` — background launcher used by the scheduled task
- `scripts/`, `backup/` — build + database backup/restore helpers
- `drizzle/` — DB schema migrations
- `RUNBOOK.txt` — one-page safety & update ritual
- `woodtek-snapshot.bat` — dated zip snapshot before any change

## Build & run (on the factory PC)
```
npm install                 (once)
node scripts\build-prod.cjs
start-woodtek-prod.bat      (or the scheduled task runs the silent bat)
```

## Configuration & checks
- `.env.example` documents every environment variable — copy to `.env` on a fresh install (the factory PC already has one).
- CI (`.github/workflows/ci.yml`) runs lint → typecheck → render-test → build on every PR; a PR that fails any of these must not be merged.

## Language (since 2026-09-30)
- Top-bar EN / العربية / Français, remembered per device (`localStorage`).
- Covers the sidebar and top bar, the sign-in screen, the dashboard quick bar +
  morning digest, the Orders list chips/kanban columns, the Operator Station
  actions, the Warehouse board and the Dispatch queue.
- Labels are keyed by the exact English default (`src/lib/i18n.ts`); unknown
  strings pass through, so Menu Designer names and client/machine names are
  never overwritten. No RTL layout flip yet — Arabic renders inside the normal
  layout.

## Purchasing & Suppliers (POs/GRNs shipped in PR #10; supplier A/P follow-up added 2026-10-01)
- Manager always has access. For anyone else, turn on **Purchasing & Suppliers** in
  Settings → System Settings → Optional modules and grant the role or person. **Invoicing &
  Money** is a separate grant for PO prices, material unit costs and machine
  hourly rates; without it, staff can still create quantity-only POs and GRNs.
  Supplier bills, payments and A/P aging require **both** grants.
- Add a supplier → create a PO (or use **+ Create PO** on a low-stock alert to
  prefill the material, suggested quantity and recent supplier) → record a goods
  receipt for the quantity actually delivered. The GRN increments stock in the
  same database transaction and keeps a history; partial deliveries remain
  awaiting per supplier. Closing a short PO preserves its GRNs.
- With both grants, use **Supplier bills & A/P** to record a supplier invoice
  reference, bill/due dates, total including supplier tax, notes and optional PO
  link. Record partial/full cash, transfer, check or other payments, see outstanding
  balances and per-supplier aging (Current through 90+ days). Payment retries
  cannot double-post; voids and bill cancellations require a reason and stay in
  the register. A bill entry is an AP record only—it does not add stock or alter
  the PO's prices.
- First granted Purchasing visit creates five procurement tables; first A/P visit
  creates two supplier-bill/payment tables, all indexes additively. The database
  role needs permission to create tables. No separate migration command is
  needed for existing factory installations; run the usual update ritual.

## Invoicing & A/R (shipped in PR #10, merged 2026-10-01)
- Manager always has access. For anyone else, turn on **Invoicing & Money** in
  Settings → System Settings → Optional modules and grant the role or person — the same
  switch that reveals money everywhere else now also owns the **Invoicing & A/R**
  screen. Nothing on this screen (prices, totals, payments) is visible without it.
- Create a **quotation** (VAT rate defaults to 11% Lebanon, editable per
  document) → when the client accepts, **Convert to invoice** (issued today,
  default 30-day terms or your own due date; the quote stays in history) →
  **Record payments** (cash/transfer/check/other) as they arrive. An invoice is
  fixed once issued — to correct one, delete its payments and cancel it; the
  legal number is never reused. Documents number themselves per calendar year
  (QUO-2026-000001, INV-2026-000001) without gaps.
- The **A/R aging** tab buckets every unpaid remainder per client (Current,
  1–30, 31–60, 61–90, 90+ days past the due date). Each document prints a
  house-style **PDF** (lines, VAT totals, payment history and balance due).
- Invoices and their payments appear automatically in the client's **ledger**
  tab (Clients & Architects) and feed the Statement PDF and the cached client
  balance used for credit checks. Hand-entered ledger entries (opening balances,
  goodwill credits) still work; do not also record a document by hand or it will
  count twice — those entries are marked "Invoicing & A/R" and cannot be deleted
  from the ledger (void the document instead).
- The first visit to the granted screen creates four invoicing tables and their
  indexes additively, alongside the purchasing tables' ritual. PR #10 merged
  2026-10-01 — run the usual factory PC update ritual to deploy.

### Line stock picker (follow-up — PR #15 open, in review, not yet deployed)
- Every quotation/invoice line description is now a **searchable stock picker**:
  click the field to open the stock list, or type to filter it by item name,
  SKU, category or unit. Picking an item saves the line's **stock link** and a
  stable **"Name (SKU)" description snapshot**, so the printed document still
  reads correctly after the item is renamed.
- Custom service/fee lines still work: type anything instead of picking, or
  press **Unlink (keep as custom text)** to keep the typed text as a custom
  description. Editing the text after picking unlinks the line.
- Picking an item changes nothing else — **no stock movement and no price**. The
  sales price is never copied from the item's cost and stock quantities are
  untouched; the picker only ever sees stock identity (name, SKU, category,
  unit), never costs or quantities.
- Quotations keep their links, and **Convert to invoice** carries the links and
  the description snapshots onto the invoice. Deleting a stock item later only
  clears its link — the saved line keeps its snapshot text.
- Database: one nullable `invoice_lines.inventory_item_id` column (FK to the
  stock item, `ON DELETE SET NULL`) plus its index, added **additively** by the
  same lazy first-visit setup. Existing lines keep their snapshots and simply
  start unlinked — no migration step, same update ritual.
- **Status: prepared for review, not yet deployed to the factory PC.** Owner
  smoke test after the branch is reviewed and merged: create an invoice → click
  a line's description and watch the stock list open → type a SKU fragment to
  filter → pick an item, confirm the field fills with "Name (SKU)" and the
  green *Linked to stock* tag appears → type a service fee on the next line and
  confirm it stays a custom description → save, then convert a quotation with a
  picked line and confirm the invoice shows the same link.

## Job Costing & Profit (Phase B item 3, PR #12 — merged 2026-10-01)
- New **Job Costing & Profit** screen answers "which jobs and clients actually make
  money?". It is behind the same **Invoicing & Money** switch as Invoicing & A/R
  (Manager always; others via Settings → System Settings → Optional modules). A Sales
  Coordinator who holds the grant sees only their own orders.
- Per order: **order value − materials − machine time − operator labor − overhead**.
  Materials come from the order's stock allocation (consumed + reserved; released
  stock costs nothing). Machine time = recorded minutes × each machine's hourly
  rate (Shop Floor Monitor). Operator labor and overhead are set once by a
  Manager under **Rates** on the screen (labor $ per hour, overhead % of direct
  cost) — until a labor rate is entered, people's time counts as $0 and an amber
  banner says so.
- **Completed/Delivered orders show their final margin from actual time; open
  orders show a projected margin** (unfinished steps at plan, overruns at actual)
  so a half-built job never looks better than it will be. Scrap/rework is shown as
  a memo and not charged twice.
- Tabs: **Orders** (sortable/searchable, click a row for the full cost sheet),
  **By client** and **By project type** (ranked by profit). Filter by period (all
  time / this year / last 90 days / this month) and by finished vs in progress;
  **CSV** exports the rows shown. Red dot = losing money, amber = thin margin or
  time overrun, grey = data to check (e.g. a machine with no hourly rate).
- Costs are calculated when you open the screen, not stored — changing a rate
  re-prices every order, old and new. No database changes: nothing to run on the
  factory PC beyond the normal update ritual.
- The **System Reports → Order Profitability** report now uses the same numbers
  (it also gained an Overhead column, no longer charges released stock, and is
  limited to the signed-in user's own orders).

## HR & Payroll
- The **HR & Payroll** screen is part of the Workforce installer add-on. Manager
  always has access when that add-on is installed; for anyone else, switch on
  **HR & Payroll** in Settings → System Settings → Optional modules and grant it
  to a role or one person. Nine of the ten HR APIs enforce this grant
  (`/api/hr/availability` — the "who is on leave that day" list the shift
  planner and machine crews read — needs only a signed-in user and reveals
  nothing but the name, the leave type and the return date). Responses
  containing private pay or leave data are marked `no-store`.
- The employee directory is built from existing user accounts; it does not create
  a second login. Set each employee's private job title, hire date and monthly
  base salary (USD). Salary is stored in a dedicated HR table, not in the shared
  `/api/users` response. Only employees with an HR profile are added to payroll.
- **Leave & Absence** records Annual, Sick, Unpaid or Other leave by inclusive
  calendar dates, with an optional short administrative note. Pending/approved
  date ranges cannot overlap for the same employee. HR users can approve or
  decline pending records; employee name/role snapshots preserve the history if
  an account is later removed. Avoid entering diagnoses or other sensitive
  medical details in notes.
- **Working Calendar** (HR → Working Calendar) holds one company-wide setup,
  saved to `data/hr-calendar.json` (no database migration, atomic write, read
  back without a restart):
  - **days of work** — tap the days the factory works (Mon–Fri, Mon–Sat,
    Tue–Sat or every day); everything else counts as a day off;
  - **daily hours of work** — start, end and the unpaid break (default
    08:00–17:00 with 60 minutes = 8 h/day), which also gives the standard hours
    of the month used to turn a monthly salary into an hourly rate;
  - **national and religious holidays** — name, type (National / Religious /
    Company / Other), single day or a span (Eid), *repeats every year* for fixed
    feasts and national days, paid or unpaid, optional note;
  - **overtime rules** — company rate per hour (0 = derive from each salary),
    the multiplier for a working day / day off / holiday (150 % / 150 % / 200 %
    by default), a daily overtime cap and whether overtime needs approval;
  - **leave rules** — two switches for what an *approved* leave blocks: sign-in,
    and assigning/processing work.
- **Overtime** (HR → Overtime) records hours per employee per day, with optional
  from/until times (only the hours beyond the standard day count as overtime).
  The rate per hour is suggested — company rate, else monthly salary ÷ that
  month's standard hours — multiplied by the day type, and can be overridden per
  entry. Amounts are integer cents, recomputed server-side. Entries are Pending
  until approved (unless the calendar says approval is not required); the daily
  cap counts Pending + Approved together, one entry per employee per day, and a
  day covered by approved leave is refused. **Approved entries are paid by that
  month's payroll draft** as one earnings line each and lock until the draft is
  deleted (which frees the hours again).
- **Leave enforcement.** An employee on *approved* leave cannot sign in, be
  assigned work or process work. The sign-in screen badges that person
  (**On leave**), explains it (**On approved leave … Back on 12 Oct 2026**) and
  disables the PIN pad; an already-open session ends, so every screen drops the
  employee. The server refuses a shift assignment for a leave day, handing an
  order step or machine task to that employee, clocking them in, starting or
  completing work in their name, and recording overtime on a leave day — each
  answering “*… is on annual leave until …*”. Pickers warn first: the shift
  planner and the machine crew lists read `/api/hr/availability` and label
  anyone on leave before a save is attempted. Safety valve: the **last active
  Manager sign-in is never blocked**, so somebody can always get in and fix a
  wrong leave record; and every gate **fails open** if the HR tables are missing
  or the database errors, so leave can never lock the factory out.
- **Payroll & Payslips** creates at most one draft per month from the active
  employees' current salary profiles. Each draft snapshots names, roles and base
  salary, adds **approved overtime** for that month as earnings lines, then
  accepts manually entered earnings and deductions; net pay is recalculated
  server-side in integer cents. Draft runs may be adjusted or deleted.
  **Posting locks the run and payslips**; the printable payslip clearly says
  DRAFT until posted.
- This is a controlled payroll worksheet, **not a local-law payroll engine**:
  it does not calculate statutory tax/social contributions, leave accrual or
  automatic leave deductions. Leave records do not change pay by themselves.
  Confirm amounts and local policy before posting; manual earning/deduction
  lines are the HR user's responsibility.
- Five HR tables and indexes are created additively on first granted access (and
  are also included in a fresh installer's schema). Existing PCs use the normal
  update ritual; no separate migration command is needed, but the database role
  must be allowed to create tables.

## Turnkey Windows `.exe` Installer (`WoodTek-ERP-Setup.exe`)
To package WoodTek ERP as a single-file Windows installer (`dist-installer\WoodTek-ERP-Setup.exe`) that you can take to any new Windows 10/11 computer:
```
build-installer.bat
```
- **What `build-installer.bat` packs into `WoodTek-ERP-Setup.exe`:**
  1. The production Next.js standalone server (`.next\standalone` + static assets).
  2. A portable Node.js runtime (`runtime\node\node.exe` copied from your build PC so the target PC works immediately).
  3. Complete idempotent database schema (`installer\schema.sql` — all 38 tables and indexes) + database bootstrapper (`installer\bootstrap-db.cjs`).
  4. Turnkey setup engine (`installer\install-engine.ps1`) that auto-installs PostgreSQL 16 in unattended mode if PostgreSQL is not yet installed, creates the `woodtek_erp` database, writes `.env` with a fresh cryptographic `AUTH_SECRET`, opens Windows Firewall port 3000, registers `\WoodTek ERP` and `WoodTek Nightly Backup` scheduled tasks, and creates Desktop/Start Menu shortcuts. (Pass `-BundlePostgres` to `installer\build-installer.ps1` to embed the PostgreSQL installer inside the `.exe` for 100% offline setup.)
- **Selectable Module Packs during `.exe` Installation (Hard-Locked Edition):**
  - **Core Production & Stock** is always installed as the base (Orders & Routing, Shop Floor Monitor, Operator Station, Live WIP, Material Reception, Warehouse (with the warehouse register), Inventory (wood, edge & panel stock), Dispatch Schedule, Gantt Chart, Production Report, Clients & Architects, Scrap & Rework, Downtime Log, Routing Recipes, PIMS Import, Plant Performance, System Reports, Menu Designer, Settings).
  - During the Setup Wizard, you tick any combination of the **4 optional add-on packs**:
    1. **Invoicing, Job Costing & Money** (`invoicing`, `jobcosting`, plus all financial columns across the app)
    2. **Purchasing & Suppliers** (`purchasing`, POs, GRNs, and Supplier Bills & A/P)
    3. **Asset CMMS** (`cmms` — Generators, Power Telemetry & Preventative Maintenance)
    4. **Workforce, Shifts & HR** (`workforce` — Shift Calendar, Time & Attendance, HR/Payroll)
  - The installer writes your selection to `data\installed-edition.json`. Any add-on **not** ticked during setup is **hard-locked** on that PC (hidden from the sidebar, blocked with 403 on all API routes even for Manager, and locked as `NOT INSTALLED` in Settings → System Settings → Optional modules). To add or remove modules later, simply re-run `WoodTek-ERP-Setup.exe` (or run `powershell -ExecutionPolicy Bypass -File installer\configure-edition.ps1 -Addons "invoicing,cmms"`).
  - Existing factory PCs without `data\installed-edition.json` default to the **Full Edition** (all 4 add-ons installed).

## Role behaviour (since 2026-09-07)
- Machine Operator: sidebar shows only Operator Station Mode, Scrap & Rework,
  Workforce & Shifts; Active Role Persona panel hidden; PIN switch kept.
- Manager: Routing Recipes, Downtime Log, Workforce & Shifts, PIMS Import and
  Shop Floor Monitor are grouped under General Settings.
- Matrix lives in `src/lib/moduleAccess.ts`; enforced by sidebar + page guard.

## Update flow
Two different jobs. The full procedure — including rollback and a troubleshooting
table — lives in **[UPDATING.md](UPDATING.md)**.

- **Build PC** (the one with `src\` and git): once the change is pushed,
  double-click `update-woodtek.bat` — it pulls, installs, stops the server,
  rebuilds and restarts it.
- **Installed PC** (`C:\WoodTek-ERP`, no git, installed from
  `WoodTek-ERP-Setup.exe`): run `build-update.bat` on the build PC to produce
  `dist-update\WoodTek-ERP-Update-<version>.zip`, copy the `.zip` **and** its
  `.sha256` file to the target PC, then double-click
  `installer\apply-update.bat` there.

`.env`, `node_modules/`, `.next/`, `logs/`, `backups/` and `data/` are NOT
tracked, and an update never overwrites them on the target machine.
