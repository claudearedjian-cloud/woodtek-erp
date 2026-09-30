# WoodTek ERP — Deep Check & Professional-ERP Roadmap

_Audit date: 2026-09-30. Branch: `arena/01a0ed73-woodtek-erp`, commit `ec526a6` (includes PR #5).
Everything below was verified hands-on: install, typecheck, 555 render-test checks, ESLint attempt, `npm audit`, and a full standalone production build (52 pages)._

> **Status 2026-09-30:** Fix bundles 1+2+3 below are **implemented** in PR #6 (security updates, ESLint + CI, atomic writes, .env.example, repo hygiene). Remaining: #4 database indexes, then the Phase B–D ERP modules.


---

## Part 1 — Health check: what's healthy ✅

The foundations are genuinely strong — better than most small-business apps:

| Area | Status |
|---|---|
| Type safety | `tsc --noEmit` **clean**, strict mode ON |
| Test harness | `render-test.js` **555/555 PASS** |
| Production build | Standalone build succeeds — 52 pages, only the known nonfatal NFT warning |
| Authentication | HMAC-signed cookies, timing-safe compares, bcrypt PIN hashes (legacy plaintext auto-upgrades), login rate-limiting + lockout, 12h sessions, production refuses to start without `AUTH_SECRET` |
| API security | **Default-deny edge guard** (`src/proxy.ts`) + every route re-checks permissions with `authorize()`/`can()` — I checked all 50+ routes, no gaps |
| Dangerous routes | dbtools (backup/restore/DB repair) and seed are correctly locked to `users:manage` / first-run-only |
| File uploads | Delivery photos validate type/size, traversal-safe names — good |
| Concurrency | Start/finish uses compare-and-set style 409 guards; stock debits clamp at zero; advisory locks where needed |
| Data safety | Nightly DB + FULL system backups with restore, audit log on every write, delivery photos stored outside the DB |
| Code hygiene | No TODO/FIXME debt, no `eval`, no stray `dangerouslySetInnerHTML` (the one is a deliberate, static error banner) |

## Part 2 — What needs fixing 🔴 (ranked by risk)

### 1. CRITICAL — Security updates for installed packages
`npm audit` on the production dependencies reports **1 critical, 4 high, 2 moderate**:

| Package | Now | Problem | Fix |
|---|---|---|---|
| `next` | 16.2.6 (pinned) | **Critical: middleware/proxy bypass** (GHSA-6gpp-xcg3-4w24 — this app *uses* `src/proxy.ts` as its API guard), plus DoS, SSRF & cache-confusion advisories | upgrade to **16.3.7** |
| `nodemailer` | 6.9.14 (pinned) | High: SMTP header/command injection family | upgrade to **10.0.6+** |
| `postcss`, `sharp` | transitive | High (come with Next) | resolved by the Next upgrade |
| `exceljs` → `uuid` | 4.4.0 | Moderate: buffer bounds bug in old `uuid` | upgrade `exceljs` |

This is a LAN app behind a trusted network, which lowers real-world risk — but the middleware-bypass advisory targets exactly the pattern this app relies on, and the email engine talks to the outside internet. **Recommended: do this bundle first.** Verification after upgrade: full `tsc` + `render-test` + build + one login/email smoke test, then the normal PC update ritual.

### 2. HIGH — `npm run lint` is broken: ESLint was never configured
`eslint` and `eslint-config-next` are installed and a `lint` script exists, but there is **no `eslint.config.js`** — the script just errors out. Nobody has ever been able to lint this codebase. Fix: add a flat ESLint config, run it, fix whatever it flags (likely unused imports/vars and a few hook deps). This becomes the cheap guardian that keeps 167 source files healthy.

### 3. HIGH — The database has **zero indexes**
21 tables, 32 foreign-key relationships, no indexes beyond primary keys. Every "orders for this customer", "operations for this machine", "downtime this month", "audit by date" query scans whole tables. Fine at today's size, but attendance, downtime, operations and audit rows accumulate daily — the app will slowly get sluggish with no obvious cause. Fix: add the ~15 obvious FK/date indexes to `schema.ts` and apply with `drizzle-kit push` on the PC (purely additive — no data touched, respects the no-migrations rule; we can also fold it into the existing Schema-Check repair channel so it's a one-click Manager action like the inventory repair).

### 4. MEDIUM — Live database dumps are committed inside the git repo
`backup/woodtek_factory_*.dump` (3 files, latest Sept 7) are tracked in git. They contain **everything**: user accounts with PIN hashes, customers, financials. The repo is private, but a leaked token or added collaborator = full factory data, and files live in git history forever. Recommendation: stop tracking them (`git rm --cached`), keep them in the ignored `backups/` folder — the nightly backup task already protects them. Owner's call — README documents this as deliberate.

### 5. MEDIUM — Four data files are not written crash-safely
Most JSON stores use temp-file + atomic rename. But `audit.server.ts`, `materialProgress.server.ts`, `materialRoutes.server.ts`, `rolesConfig.server.ts` write directly — a crash/power-cut mid-write can leave a truncated file (the audit file rewrites constantly, so it's the most exposed). Fix: switch them to the same temp+rename helper (one small shared function, ~30 lines).

### 6. MEDIUM — No `.env.example`
18 environment variables (`DATABASE_URL`, `AUTH_SECRET`, `AUTH_COOKIE_SECURE`, `WOODTEK_DATA_DIR`, backup dirs, build vars…) exist only in someone's memory and the handoff chat. A fresh clone dies with "DATABASE_URL is required" and no hint. Fix: add `.env.example` with commented defaults + link from README.

### 7. MEDIUM — No CI: nothing verifies a change before the factory PC pulls it
Every check is run manually by the agent. A GitHub Actions workflow that runs `typecheck` + `render-test` + a build on every PR (with a dummy `DATABASE_URL`) makes bad updates structurally impossible to merge. Cheap, high leverage — and it enforces your new "no merge without approval" rule mechanically.

### 8. LOW — Repo clutter & stale artifacts
- `compiled/` — 14 legacy compiled JS files still tracked; nothing references them; the ignore rule only stops *new* ones. Untrack them.
- `tsconfig.tsbuildinfo` — build cache tracked in git; pure diff noise. Untrack.
- `ws` dependency — installed but never imported. Remove (or keep for the realtime roadmap item below).
- `package.json` name is still `nextjs-postgresql-template` — cosmetic.

### 9. Noted, no action needed now
- Rate limiting & session state are in-memory (reset on restart) — fine for one server; matters only if you ever run multiple instances.
- Times use the server PC's local clock — correct as long as the factory PC timezone is Beirut. Just don't change it casually.

---

## Part 3 — Roadmap: from shop tool → full professional ERP

What exists today is a strong **production/operations ERP**: orders, routing, scheduling (Gantt + auto-planner), shop floor (operator station, WIP, wall board, reception), CMMS, inventory + BOM + warehouse, dispatch/delivery, quality, downtime, workforce/shifts/attendance, customers + quotations + ledger, reports/OEE/production report, email docs, backups. The gaps to "full ERP" are mostly on the **money side** and **people side**:

### Phase B — Close the money loop (highest business value)
1. **Purchasing & Suppliers** — supplier records, purchase orders, goods-receipt (GRN) that increments stock, supplier bills & payments, "awaiting delivery" list per supplier. Today stock arrives via Excel import with no procurement trail. Hooks directly into the reorder-point alerts that already exist (`stockCheck.ts`).
2. **Invoicing & Accounts Receivable** — proper **VAT invoices** (11% Lebanon) with legal numbering, quotation → invoice conversion, payment recording, A/R aging per client, and printable/PDF invoices (the PDF engine and client ledger already exist — this completes the loop they started).
3. **Job costing & profitability** — per-order and per-client margin: quoted value − materials consumed (already costed) − labor hours × rate (hours already tracked) − machine time × hourly rate. This is usually the #1 missing insight for a furniture maker: *which jobs and clients actually make money?*

### Phase C — Operations depth
4. **HR & payroll** — attendance and shifts already exist; add leave/absence tracking and a payroll calculator (salary, additions/deductions, printable payslips).
5. **Warehouse depth** — bin/locations, stock transfers, stocktake (count sessions with variance report).
6. **Quality** — non-conformance reports (NCR) incl. supplier defects, feeding a supplier-quality score.
7. **CRM for the Sales Coordinator** — multiple contacts per client, communication log, follow-up reminders (extends the existing stale-quotation alerts into a real pipeline).

### Phase D — Professional polish
8. **Monthly management pack** — one PDF/email: sales, margins, on-time %, scrap %, downtime Pareto; auto-emailed monthly (email engine already exists).
9. **Per-role user guides** — printable one-pagers per role; protects you against staff turnover.
10. **Accountant export** — ledger/invoice CSV-Excel export for your accountant.
11. Later/optional: full UI Arabic/French (quotation PDFs already are), live websocket updates (`ws` is already in package.json), PWA offline mode for shop-floor tablets.

### Suggested order of execution
| # | Bundle | Effort | Why first |
|---|---|---|---|
| 1 | Security updates (Next 16.3.7, nodemailer, exceljs) + regression run | ~half day | Critical advisory on the exact guard pattern we use |
| 2 | ESLint config + fix findings + CI workflow | ~half day | Makes every future bundle safer; enforces your no-merge rule |
| 3 | Atomic writes + `.env.example` + repo hygiene (untrack dumps/compiled/tsbuildinfo, drop `ws`) | ~half day | Small, zero-risk hardening |
| 4 | Database indexes (via one-click repair or drizzle push) | ~half day | Future-proofs speed before data grows |
| 5 | **Purchasing & Suppliers** | 2–3 days | First real ERP gap |
| 6 | **Invoicing + VAT + A/R** | 2–3 days | Completes the money loop |
| 7 | **Job costing / profitability** | 1–2 days | The insight bundle |

Each item ships as its own PR — built, verified (typecheck + render-test + build), then **held for your approval before merging**, per your standing rule.
