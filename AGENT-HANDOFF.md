# WoodTek ERP — Handoff for a New Chat / Agent Session

_Last updated 2026-09-08. Read this first. The owner is NOT a developer — give exact copy-paste commands._

## What this project is
- Next.js **16.2.6** (standalone output) + PostgreSQL factory ERP ("WoodTek ERP – Furniture Service Center").
- Runs on a **Windows 10 PC**, folder `C:\woodtek-erp\woodtek-erp`; serves `0.0.0.0:3000`; LAN URL `http://192.168.220.179:3000`.
- Roles: Manager (Claude Aredjian), Machine Operator (maroun rahme), Sales Coordinator, QA & Dispatch, Technician.

## Source of truth
- **Private GitHub repo: `https://github.com/claudearedjian-cloud/woodtek-erp` (branch `main`).**
- The PC folder is a clone of it. Before any git work on the PC, check `git remote -v` points there.
- Other repos (`erp`, `system2`, `executable`) are old/other-session — **never** push or reset WoodTek code from them.
- To give an agent write access: create a **fresh fine-grained PAT** (only `woodtek-erp`, permission *Contents: Read and write*, short expiry), paste it in chat, revoke afterwards. Chat attachments accept images/text/md/json/pdf — **not .zip** (workaround: `copy x.zip x.txt` then attach the .txt).

## Deploy ritual (every change)
Agent commits + pushes to `main`; then on the PC, **in this exact order**:
```
git pull
node scripts\build-prod.cjs
schtasks /End /TN "\WoodTek ERP"
schtasks /Run /TN "\WoodTek ERP"
```
- **Never build while the task is running** → `EBUSY ... rmdir .next\standalone`.
- The task runs **as SYSTEM** → `taskkill` is always *Access denied*; only `schtasks /End` / `/Run` control it.

## Runtime architecture
- Scheduled task `\WoodTek ERP` (runs at logon) → `start-woodtek-prod-silent.bat` → `node start-prod.cjs --no-browser` → `node .next/standalone/server.js`. Logs: `logs\woodtek.log`.
- `start-prod.cjs` is the **v2 watchdog**: restarts real crashes (max 6/min), on `EADDRINUSE` it does NOT loop — it prints the owning PID and defers; health probe trusts only its own child process.
- `start-woodtek-prod.bat` = interactive launcher; if the task already serves port 3000 it prints "already in use … not starting a second copy" (by design — close the window).
- `next.config.ts` MUST keep `output: "standalone"` and `serverExternalPackages: ["bcryptjs","pg","@types/bcryptjs"]` — without it the build produces no `.next/standalone` and the server FATALs.
- `.env` (DATABASE_URL, AUTH_SECRET, …) is **local only**: never commit, never send to chats.

## Backups
- Task `\WoodTek ERP Backup` daily 02:30 → `backup\woodtek_factory_*.dump` (also stored in the private repo).
- `woodtek-snapshot.bat` → `backups\snapshot-DATE.zip` (source+configs+.env) before manual tinkering.
- `RUNBOOK.txt` at repo root = one-page ops guide.

## Role / UI rules implemented 2026-09-07/08
- Access matrix: `src/lib/moduleAccess.ts`; enforced by `src/components/Sidebar.tsx` (rendering) and `src/app/page.tsx` (tab guard bounces to first allowed module).
- **Machine Operator** sees only: Operator Station Mode, Scrap & Rework, Workforce & Shifts (+ Auto Workflow Engine card). *Active Role Persona* panel hidden; "Switch profile (PIN required)" kept.
- **Manager**: Routing Recipes, Downtime Log, Workforce & Shifts, PIMS Import, Shop Floor Monitor are nested **under General Settings** (indented sub-menu).
- All other roles unchanged.
- **Menu Designer** (added 2026-09-08): Manager-only top-level tab (`designer` module) to rename/reorder/regroup items and toggle per-role visibility. Stored as JSON at `<project>/data/menu-config.json` (env `WOODTEK_DATA_DIR` set by start-prod.cjs; API `/api/menu-config`, PUT/DELETE require `users:manage`). Defaults live in `src/lib/menuConfig.ts` (`MENU_REGISTRY`); `resolveMenu()` merges defaults + config per role; Sidebar renders its output. Reset button deletes the file.

## Gotchas learned the hard way
1. Build-before-End ⇒ EBUSY (server holds `.next\standalone`).
2. SYSTEM task ⇒ taskkill denied; use `schtasks /End|Run`.
3. `git init` only inside the project folder (a stray repo once landed in `C:\Windows\System32`).
4. Old Aug-19 configs lacked `standalone` → silent no-standalone builds.
5. Port busy ⇒ launcher defers with a message; that message is success, not failure.
6. The zip contained a stale nested `src/src/` copy (ignored in git); the live tree is top-level `src/`.
7. PowerShell: `rmdir /s /q` is cmd syntax; use `Remove-Item -Recurse -Force`.
8. An old untracked `update-woodtek.bat` (from the zip era) can block pulls; delete it once — the repo ships the real one.
10. `schtasks /End|Run` on the SYSTEM task needs an ELEVATED shell (`Access is denied` otherwise); `update-woodtek.bat` self-elevates via UAC.
9. Repo config files (`tsconfig.json`, `next.config.ts`, `next-env.d.ts`) can get dirty locally and block pulls; `update-woodtek.bat` now runs `git checkout --` on them before every pull — repo version always wins.

## How the agent verified changes (rebuild if needed)
- `npm install && npm run typecheck` (`tsc --noEmit`) in a clone — the project's own check.
- A `render-test.js` SSR harness (typescript `transpileModule` + `react-dom/server`) rendered the real `Sidebar` per role and asserted hidden/visible labels (39 checks). Needs `typescript`, `react`, `react-dom`, `lucide-react` from the repo's package.json.
