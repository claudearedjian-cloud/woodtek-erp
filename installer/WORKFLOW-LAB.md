# WoodTek Workflow Lab (side-by-side test installation)

A second, independent WoodTek installation for testing production workflows
without going anywhere near the factory system. Created by the visible
double-click helper **`Create-WoodTek-Workflow-Lab.bat`** in the repository
root; it asks for administrator rights by itself and it always pauses, so an
error can never flash past.

This document says exactly what the helper creates and what it leaves alone.

---

## 1. What the helper creates

| Thing | Value |
| --- | --- |
| Folder | `C:\WoodTek-Workflow-Lab` (override with `-TargetDir`) |
| Web address | `http://localhost:3001` (override with `-Port`) |
| Database | `woodtek_workflow_lab` on the local PostgreSQL server |
| `DATABASE_URL` | `postgresql://postgres:<password>@localhost:5432/woodtek_workflow_lab` |
| Scheduled task | `\WoodTek Workflow Lab` (starts the lab at boot, runs as SYSTEM) |
| Backup task | `WoodTek Workflow Lab Nightly Backup` (daily 02:30) |
| Firewall rule | `WoodTek Workflow Lab Server` (inbound TCP, lab port only) |
| Desktop shortcut | `WoodTek Workflow Lab.lnk` |
| Start Menu folder | `WoodTek Workflow Lab` (open, start server, stop, update) |
| Log file | `<lab>\logs\woodtek-workflow-lab.log` |
| Data folder | `<lab>\data` (`WOODTEK_DATA_DIR` points there) |
| `AUTH_SECRET` | freshly generated for the lab (32 random bytes, base64) |
| Instance record | `<lab>\workflow-lab-instance.json` |

Helpers written into the lab folder (all lab-scoped):

| File | What it does |
| --- | --- |
| `start-workflow-lab.bat` | starts the lab in a window (opens the browser) |
| `start-workflow-lab-silent.bat` | used by the scheduled task, logs to `logs\` |
| `stop-workflow-lab.bat` | ends the lab task and frees the **lab** port |
| `check-workflow-lab.bat` | read-only health check (`check-server.js`) |
| `update-workflow-lab.bat` | re-runs the installer in `Refresh` mode for this folder |
| `README-WORKFLOW-LAB.txt` | plain-language notes for whoever opens the folder |

### Modules

* **Installed:** Core Production & Stock (orders, routing, shop floor, operator
  station, WIP, reception, warehouse & BOM, stock, dispatch, Gantt, clients,
  quality, downtime, reports) **plus Asset CMMS**, which is not one of the
  modules the owner asked to lock.
* **Hard-locked:** Invoicing & Money, Purchasing & Suppliers, HR & Payroll and
  Design Department.

The lock is the *installation* lock, not a hidden menu: it is written to
`<lab>\data\installed-edition.json` as

```json
{ "version": 1, "addons": ["cmms"],
  "lockedOptionalModules": ["invoicing", "purchasing", "payroll", "design"] }
```

* `addons` locks the three modules that have an installer add-on pack
  (`invoicing`, `purchasing`, `workforce`/payroll) exactly the way
  `WoodTek-ERP-Setup.exe` has always locked omitted packs.
* `lockedOptionalModules` is the installation-level lock that also covers
  modules without a pack — today that is **Design**. Nobody has a locked
  module, Manager included; the sidebar hides it, every API route refuses it,
  and Settings shows it as **LOCKED** instead of offering a switch.
* An installation whose `installed-edition.json` has no `lockedOptionalModules`
  behaves exactly as before — this is why the factory PC is unaffected.

## 2. What the helper leaves untouched

* `C:\WoodTek-ERP` — no file is written, renamed or deleted there. The lab only
  **reads** app files from it (see §3) and never calls its installer, its start
  scripts or its updater.
* The task `\WoodTek ERP` is never ended, registered or restarted.
* The task `WoodTek Nightly Backup` is untouched; the lab's own backup task
  dumps only `woodtek_workflow_lab`.
* The firewall rule `WoodTek ERP Server` is untouched (the lab has its own
  rule name, so the delete/recreate step can never remove the factory rule).
* The shortcut `WoodTek ERP.lnk` and the Start Menu folder `WoodTek ERP` are
  untouched.
* The database `woodtek_erp` is never connected to, dumped, migrated or
  dropped. The preflight refuses any connection string that resolves to it.
* The default installer (`installer\install-engine.ps1`) keeps its defaults
  (folder, port 3000, `woodtek_erp`, `\WoodTek ERP`,
  `WoodTek Nightly Backup`, `WoodTek ERP Server`, `WoodTek ERP.lnk`)
  exactly as they were. A guard in `scripts/workflow-lab-test.cjs` fails the
  build if any of them moves.
* `WoodTek-ERP-Setup.exe`, `apply-update.ps1` and `update-woodtek.bat` refuse to
  run against a lab folder (they would point it at `woodtek_erp` or stop the
  factory task) and name the lab helper to use instead. Those three refusals are
  the only lines ever added to the factory tooling.

## 3. Where the lab's application files come from

The installer picks the first option that is both available and safe, and says
which one it used:

1. **`-PayloadZip <zip>`** — a prepared standalone payload (same layout as the
   payload inside `WoodTek-ERP-Setup.exe`).
2. **Copy (`-AppFiles copy`)** — a read-only copy of `.next\standalone`,
   `runtime\node`, `start-prod.cjs` and `check-server.js` from the existing
   installation. No `.env`, `data`, `logs`, `backups` or uploads are copied.
   Used only when that build already understands the lab lock
   (`lockedOptionalModules`); otherwise the next option is used, because a build
   without it could still switch Design on.
3. **Build (`-AppFiles build`)** — `npx next build` in this repository, then the
   standalone output is copied into the lab. This deliberately does **not** use
   `scripts\build-prod.cjs`, because that script stops the server on the port it
   is about to build for; the lab build never stops anything and never bumps
   `version.json`.

Nothing is ever fetched from a database dump and nothing is restored.

## 4. Safety model (what refuses, and where)

All of it lives in `installer\workflow-lab\preflight.cjs` and runs twice: before
anything is created, and again on the finished installation.

Refused, with a readable reason and **without changing anything**:

* a target folder that is the factory folder, inside it, above it, a Windows
  system folder (`C:\Windows`, `C:\Program Files`, …) or a whole drive;
* a target that already holds unrelated data, a foreign WoodTek installation,
  or an existing lab (use `update-workflow-lab.bat` for that one);
* a port that is the factory port (3000) or otherwise reserved;
* a database name that is not exactly `woodtek_workflow_lab`, that is one of
  `woodtek_erp`/`postgres`/`template0`/`template1`, or that lives on another
  server;
* a source folder that is not a WoodTek installation, or is the target itself;
* after the install: a `.env` whose `DATABASE_URL` is not the lab database, a
  `.env` on the wrong port, an installed-edition file without the four locks, a
  locked module switched on or granted to a role/person, and any second `.env`
  that came along with copied files.

Every name the lab registers comes from `installer\instance-registry.json`,
which lists both instances side by side; the registry itself is validated (the
two profiles may not share one name, port or database).

## 5. Running it

```
Double-click  Create-WoodTek-Workflow-Lab.bat          (recommended)
```

or, from an administrator PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File installer\install-workflow-lab.ps1
# a different folder / port:
... -TargetDir "D:\WoodTek-Workflow-Lab" -Port 3002
# refresh an existing lab (keeps its .env and its test data):
... -Action Refresh -TargetDir "C:\WoodTek-Workflow-Lab"
# prove an existing lab is still its own instance (read-only):
... -Action Verify  -TargetDir "C:\WoodTek-Workflow-Lab"
```

Port 3001 is checked before anything is created; if something already holds it
the helper stops and tells you to pass `-Port`. The Postgres super-user
password defaults to `postgres` (same default the setup wizard uses) and can be
passed with `-PgSuperPassword`.

## 6. Verifying it afterwards

```
node scripts\workflow-lab-test.cjs        # repo guard suite (no Windows, no DB)
```

On the PC, the same safety checks can be re-run against the live folder without
changing anything:

```
powershell -ExecutionPolicy Bypass -File C:\WoodTek-Workflow-Lab\installer\install-workflow-lab.ps1 ^
    -Action Verify -TargetDir C:\WoodTek-Workflow-Lab
```

The guard suite proves the lab keeps its own database, port, scheduled tasks,
backup task, firewall rule and shortcuts, that the four optional modules are
hard-locked, and that the existing installer's defaults did not move. It runs in
CI on every pull request (`npm run test:workflow-lab`).

## 7. Removing the lab

Deliberately manual, so no script can delete test data by accident — the exact
steps are in `README-WORKFLOW-LAB.txt` inside the lab folder (stop the lab,
delete its two tasks, delete its firewall rule, delete its shortcuts, optionally
drop `woodtek_workflow_lab`, delete the folder).

## 8. Troubleshooting

| Symptom | What to do |
| --- | --- |
| `TCP port 3001 is already in use` | run again with `-Port 3002` (edit the shortcut afterwards if you like) |
| `predate the Workflow Lab module lock` | the factory build is older than this branch: let the helper build from the repo (`-AppFiles build`) or pass `-PayloadZip` |
| `Preflight refused …` | read the reasons — they name the exact folder/database/port that is not allowed. Nothing was changed |
| The lab starts but the page is empty | check `<lab>\logs\woodtek-workflow-lab.log`; the factory installation is unaffected |
| You want the modules back | they are locked on purpose. Re-installing the lab is the only way to change the lock list |

## 9. Explicitly out of scope

* No database dump is inspected or restored; this is a trial environment, not a
  production recovery.
* Nothing here is deployed to the FS200 server.
* The separate Next.js upgrade is not part of this work.
