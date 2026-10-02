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
  Settings → Users → Optional modules and grant the role or person. **Invoicing &
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
  Settings → Users → Optional modules and grant the role or person — the same
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
  (Manager always; others via Settings → Users → Optional modules). A Sales
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

## Role behaviour (since 2026-09-07)
- Machine Operator: sidebar shows only Operator Station Mode, Scrap & Rework,
  Workforce & Shifts; Active Role Persona panel hidden; PIN switch kept.
- Manager: Routing Recipes, Downtime Log, Workforce & Shifts, PIMS Import and
  Shop Floor Monitor are grouped under General Settings.
- Matrix lives in `src/lib/moduleAccess.ts`; enforced by sidebar + page guard.

## Update flow
Changes are committed and pushed to this repo. On the factory PC:
```
git pull
node scripts\build-prod.cjs
(restart the server)
```
`.env`, `node_modules/`, `.next/`, `logs/`, `backups/` are NOT tracked.
