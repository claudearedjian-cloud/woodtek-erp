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

## Purchasing & Suppliers (pending owner approval)
- Manager always has access. For anyone else, turn on **Purchasing & Suppliers** in
  Settings → Users → Optional modules and grant the role or person. **Invoicing &
  Money** is a separate grant for PO prices, material unit costs and machine
  hourly rates; without it, staff can still create quantity-only POs and GRNs.
- Add a supplier → create a PO (or use **+ Create PO** on a low-stock alert to
  prefill the material, suggested quantity and recent supplier) → record a goods
  receipt for the quantity actually delivered. The GRN increments stock in the
  same database transaction and keeps a history; partial deliveries remain
  awaiting per supplier. Closing a short PO preserves its GRNs. Supplier
  bills/payments are not part of this bundle.
- The first visit to the granted screen creates five purchasing tables and their
  indexes additively; the database role needs permission to create tables. No
  separate migration command is needed for existing factory installations.
  Do not deploy until the owner approves and merges the PR.

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
