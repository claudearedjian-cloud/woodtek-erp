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

## Cabinet Assembly — CSV column mapping
The default **WoodTek export** import layout uses these **one-based** CSV positions
for exports with 14 or more columns (with or without a header row):

| CSV column | Meaning |
| --- | --- |
| 7 | Part name |
| 12 | Project name |
| 13 | Cabinet name (parts are grouped by this field) |
| 14 | CIX filename / CNC program reference |

- Those four positions take precedence over header guesses. Dimensions, material,
  quantities and edge/grain fields still use their remaining headers/content.
- Leave **Project Name (Optional Override)** blank to use column 12. A deliberately
  entered name overrides it; otherwise the project-file/source filename is only a
  fallback when the CSV has no project name. Uploading a file no longer replaces
  the CSV's project name with that file's name.
- CIX paths are reduced to filenames; `.cix`/`.CIX` and references without an
  extension are accepted. Explicit references link only to that file/program;
  repeated identical parts can share it. A missing named file stays **unlinked**
  rather than borrowing an unrelated file by part name.
- The shorter bundled sample/older exports keep automatic detection. For a
  different wide CSV, choose **Other layout — detect headers / content**. Project
  and cabinet headers are distinct. A CSV with multiple project names is refused;
  export/import one project at a time to avoid mixing cabinets.
- The import report confirms the chosen layout, CSV project and field mapping.
  **Existing loaded projects are not rewritten.** Re-import the original files
  after deployment to apply the corrected mapping. This creates a new project
  with fresh scan progress; remove an older incorrect import only when ready.

## Cabinet Assembly — selected cabinet 3D preview
- After import, clicking a cabinet opens **only that cabinet’s own parts and
  attached CNC borings**, labelled with its name, part count and W × H × D in mm.
  Project + cabinet identity isolates the view even when different projects reuse
  the same cabinet/part IDs. Previous meshes and WebGL resources are released;
  rotation, zoom, explosion and toolbar settings start fresh on selection.
- Positive imported cabinet dimensions match the cabinet list. Panels retain
  their actual cutting-list sizes, including overhangs; the camera fits their
  transformed bounds on wide or narrow screens. Doors/drawer fronts stand in the
  correct width/height orientation, and inferred right sides stay at the right
  outer face rather than being overwritten as internal dividers.
- Scanning or selecting a part updates the current cabinet without allocating a
  new canvas/context. **Rotate / Pause** affects the live loop. **Reset** restores
  the assembled view, default rotation/zoom, normal edges, visible CNC holes and
  paused auto-rotation. Empty cabinets or unavailable WebGL show an explicit
  message instead of a previous model.
- This is a **reconstructed preview**, not the original Polyboard CAD scene:
  cutting-list names/sizes identify panel roles, and placement is estimated when
  design coordinates are absent. Original CSV/CIX/project files are needed to
  compare a particular cabinet against the source design; exact CAD positions
  cannot be verified from a screenshot alone.
- Viewing does not rewrite saved projects or reset their scans. **Old incorrectly
  mapped imports still need re-importing after deployment**, as described above;
  a new import has fresh scan progress.

## Cabinet Assembly — loaded project management
- Select a loaded project in the top project picker, then use **Edit Project** to
  change its name and **Notes / Job Reference**. Cabinets, parts, CNC data, scan
  progress, assembly readiness and linked ERP orders are preserved. Editing
  project details does not replace the imported cutting list or geometry.
- **Delete Project** opens a confirmation naming the project and counting its
  cabinets and parts. Confirming permanently removes that assembly project and
  its local progress/CNC data only — original Polyboard files and ERP orders are
  not deleted. The next remaining project opens automatically; deleting the last
  project shows the empty import screen and stays empty after a reload.
- The sample project is populated on first use only, never recreated after a
  deletion. You can still load sample files explicitly from the import dialog.
- Edit/delete use the existing project write permission; read-only users do not
  see those controls. Errors keep the dialog and entered values available to
  retry, and successful changes are audit-logged.
- No database migration: projects remain in `data/assembly-projects.json` (or
  `WOODTEK_DATA_DIR`), written atomically. Deploy using the normal update ritual
  after the owner approves and merges the PR.

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

## Older Windows servers: Windows 8.1 / Server 2012 R2 (since 2026-10-13)
- Node.js **23 and newer refuse to start** on Windows 8.1 / Server 2012 R2:
  `Node.js is only supported on Windows 10, Windows Server 2016, or higher`.
  The turnkey installer ships the build PC's own `node.exe`, so on such a server
  the old install stopped at the database bootstrap with only that warning on
  screen (and `start-woodtek-prod.bat` sat at `Press any key`).
- Now `installer\install-engine.ps1` **probes the runtime** (`node --version`)
  before using it and, on those Windows versions, installs **Node.js 22 LTS** —
  the newest line that officially supports them and still satisfies the app
  (Next.js needs >= 20.9; CI runs Node 22). The zip travels inside the payload
  as `prereqs\node-win-x64.zip` when it is present, otherwise it is downloaded
  from nodejs.org.
- Only if that is impossible does it fall back to Node.js' own documented
  workaround, `NODE_SKIP_PLATFORM_CHECK=1`; the start scripts
  (`start-woodtek-prod.bat`, `start-woodtek-prod-silent.bat`),
  `installer\apply-update.ps1` and `installer\configure-edition.ps1` set that
  flag on those Windows versions as well, so a hand-copied `runtime\node`
  folder still works. `start-prod.cjs` records the situation in the log.
- Windows Server 2012 R2 left Microsoft support in October 2023 and PostgreSQL
  16 is not tested on it: use it as a spare, not as the main server.
- **Virtual machines:** the message is about the *guest* Windows version, not
  about virtualization. On Hyper-V, attach the VM to an **External** virtual
  switch (the Default Switch is NAT: other PCs cannot reach `http://<vm-ip>:3000`),
  give it a fixed IP, static memory, automatic start, keep Time Synchronization
  on — and treat checkpoints as rollback points, not backups. See `RUNBOOK.txt`,
  "RUNNING IN A HYPER-V VIRTUAL MACHINE".

## Role behaviour (since 2026-09-07)
- Machine Operator: sidebar shows only Operator Station Mode, Scrap & Rework,
  Workforce & Shifts.
- Manager: Routing Recipes, Downtime Log, Workforce & Shifts, PIMS Import and
  Shop Floor Monitor are grouped under General Settings.
- Matrix lives in `src/lib/moduleAccess.ts`; enforced by sidebar + page guard.
- The sidebar footer shows the copyright (© Claude Aredjian) only — the
  Active Role Persona card and its profile switcher were removed from every
  screen on the owner's request (2026-10-13). Switching profiles stays on the
  top bar (Header → "Switch profile").

## Deleting a user account (since 2026-10-13)
- Settings → Users → **Delete** runs one engine (`src/lib/userDeletion.server.ts`,
  policy in `src/lib/userDeletionRules.ts`). The live foreign keys pointing at
  the account are read from the Postgres catalog and each one is released,
  removed with the account, kept, or refused by name.
- It **refuses** while the person is the assigned operator of a machine, is the
  operator on a Ready / In Progress / Paused station step, is the account you
  are signed in with, or is the last active Manager sign-in — the dialog lists
  exactly what to fix.
- Everything the cleaner touches is written to the audit trail, and releases +
  delete run in a single transaction.

## Client book ownership (since 2026-10-13)
- Manager sees every client. A **Sales Coordinator** sees the clients **assigned
  to them** plus the **shared pool** of clients nobody owns (`assigned sales
  rep` empty — every account created before assignment existed). A client handed
  to another rep stays private to that rep.
- Managers hand an account to a rep (or release it back to the shared pool) in
  the client file → **Edit Information → Assigned sales rep**. A client created
  by a Sales Coordinator is assigned to them automatically.
- One rule book: `src/lib/clientOwnership.ts` (list scope in
  `src/lib/dataAccess.ts`, 403 on the single-client and ledger routes).

## Moving the app to a new server (since 2026-10-13)
- **On the old server:** `backup\prepare-migration.bat` takes a fresh backup
  (custom-format `pg_dump` of the database + a zip of the `data\` JSON overlay)
  and builds a `WoodTek-Migration\` folder with the two files, a reference copy
  of `.env` and a README. The old server is only read.
- **On the new server:** install first (`WoodTek-ERP-Setup.exe`), copy the folder
  over, then `installer\restore-migration.bat`: it stops the service, keeps the
  fresh database aside (`backups\pre-migration-*.dump`), drops/recreates the
  database, `pg_restore`s the pack, restores `data\` (the previous folder is
  kept as `data-before-migration-*`), restarts the service, waits for
  `/api/health` and prints the row counts it reads back (`users`, `machines`,
  `orders`, `order_operations`) so the move is **verified, not assumed**.
- The scripts ship inside the installer payload and in update packs
  (`prepare-migration.*` into `backup\`, `restore-migration.*` into
  `installer\`); `RUNBOOK.txt` has the owner-facing steps plus a manual fallback.

## Backup & update robustness (since 2026-10-14)
- **The nightly backup was broken and silent.** `backup\backup-woodtek.ps1`
  piped its lock-file path into `Out-File` without a `-FilePath`, so PowerShell
  threw `the value of argument "path" is null` — and with
  `$ErrorActionPreference = "Stop"` that aborted **every** run, *before* the
  `try` block, so not even the log said why. The lock is now created with
  `New-Item`, and a script-level `trap` makes sure any failure — including one
  before the main work — lands in `backup-woodtek.log`.
- **`pg_dump`/`pg_restore` discovery was too narrow.** The scripts only tried
  PATH and `C:\Program Files\PostgreSQL\<newest>\bin`, so a PC whose PostgreSQL
  lives anywhere else failed with `pg_dump not found`. `backup\backup-woodtek.ps1`,
  `installer\restore-migration.ps1`, `scripts\backup-windows.ps1` and
  `scripts\restore-windows.ps1` now search, in order: `WOODTEK_PG_BIN`
  (environment or `.env`), the installer's registry entry
  (`HKLM\SOFTWARE\PostgreSQL\Installations\*\Base Directory`), the folder the
  running `postgresql*` service actually runs from, then the usual install
  folders on C:/D:/E: (every version subfolder) and finally PATH.
  `backup\find-postgres-tools.bat` is a double-clickable diagnosis that prints
  what it finds and can write `WOODTEK_PG_BIN` into `.env`.
- **PowerShell 4.0 compatibility (Windows Server 2012 R2).** The zip/unpack
  cmdlets only exist in PowerShell 5.0+. `backup\backup-woodtek.ps1`,
  `scripts\backup-windows.ps1` now build archives with
  `System.IO.Compression.ZipFile::CreateFromDirectory`, and
  `scripts\restore-windows.ps1` unpacks with a new `Expand-ZipArchiveTo`
  helper (overwrite semantics like `-Force`, plus a guard that refuses archive
  entries trying to escape the destination folder).
- **A hand-edited script that no longer parses** (`The ampersand (&) character
  is not allowed`, `The string is missing the terminator`) is what an unbalanced
  quote looks like from the outside — PowerShell only reports it far from the
  real line. `render-test.js` now walks every shipped `.ps1` the way PowerShell
  does (comments, `<# #>` blocks, `@'`/`@"` here-strings, backtick escapes,
  delimiters) and fails the build on anything that cannot parse — plus the
  exact `$LockFile | Out-File` landmine (a pipe into `Out-File` without
  `-FilePath`). `unblock-update.bat` (repo root) is the owner's one-time rescue:
  it saves a patch copy of local edits to `backups\local-edits-<date>\`, sets
  them aside with `git stash`, then pulls.
- **Updates cannot be blocked by local edits any more.** `update-woodtek.bat`,
  `woodtek-back-to-main.bat` and `woodtek-test-branch.bat` detect modified
  files, write a patch copy to `backups\local-edits-<date>\local-edits.patch`
  (with `git-status.txt`), `git stash push` them, and only then pull/switch.
  A failed stash stops the run with a readable message instead of a
  half-finished update; `git stash list` / `git stash pop` brings edits back.

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
