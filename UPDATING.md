# Updating WoodTek ERP (UPDATING.md)

One page. Read the section that matches your PC, then follow it top to bottom.

There are **two kinds of WoodTek PC**, and they update differently:

| | PC type | How you know | Update with |
|---|---|---|---|
| **A** | The **build PC** — has the source code | The folder contains `src\`, `package.json`, and you run `git` here | [Path A](#path-a--the-build-pc-has-the-source-code) — `update-woodtek.bat` |
| **B** | An **installed PC** — WoodTek was installed from `WoodTek-ERP-Setup.exe` | The app lives in `C:\WoodTek-ERP`, there is no `src\` folder | [Path B](#path-b--an-installed-pc-update-pack) — an update pack `.zip` |

> Not sure? If you can double-click `update-woodtek.bat` and the file exists, you are on **A**.
> If your app folder has `start-prod.cjs` but no `src\`, you are on **B**.

---

## Before ANY update (30 seconds, no exceptions)

1. **Take a snapshot** — double-click `woodtek-snapshot.bat` (build PC), or on an
   installed PC run `backup\backup-woodtek.ps1`. This is your undo button.
2. **Tell everyone** — updates stop the server for 1–3 minutes. Nobody should be
   mid-entry on the shop floor.
3. **Update outside production hours** if you can. The nightly backup task runs at
   01:30; do not fight it.

---

## Path A — the build PC (has the source code)

```
update-woodtek.bat        <- double-click, AFTER the code has been pushed
```

What it does, all by itself:

1. Asks for administrator rights (it needs them to stop the Windows task).
2. `git pull` — pulls the new code. It also copies any `.dump` files out of
   `backup\` into `backups\` first, so git cannot delete your database dumps.
3. `npm install` — adds any new components.
4. Stops the `\WoodTek ERP` scheduled task and kills any leftover process on port 3000.
5. `node scripts\build-prod.cjs` — rebuilds (1–2 minutes).
6. Starts the server again.

Then: open <http://localhost:3000> and check the change.

**If it prints `BUILD FAILED`** — do not re-run it yet. Copy the red text and send
it to whoever wrote the change. Nothing has been lost; the old build is still
sitting in `.next\` until the build succeeds.

**If it prints `git pull failed`** — you have local edits that clash with the new
code. Do not delete anything. Send the message to support.

---

## Path B — an installed PC (update pack)

An **update pack** is one `.zip` file that carries the new application. It is built
on the build PC, carried over on a USB stick, and applied on the installed PC.
The installed PC does **not** need git, Node.js, or an internet connection.

### Step 1 — Build the pack (on the build PC, after the code is pushed)

```
build-update.bat
```

The build has to stop the WoodTek server to rebuild the standalone folder —
`build-update.bat` **starts it again** afterwards and tells you the build number
that came back up. (If Windows blocks that, it says so and tells you the one
command to run yourself.)

Output:

```
dist-update\WoodTek-ERP-Update-20261005-0b83546.zip
dist-update\WoodTek-ERP-Update-20261005-0b83546.zip.sha256
```

The `.sha256` file is the tamper/corruption check. **Copy both files.**

Options, if you need them:

```powershell
powershell -ExecutionPolicy Bypass -File installer\build-update.ps1 -SkipBuild   # reuse the last build
powershell -ExecutionPolicy Bypass -File installer\build-update.ps1 -Version 2.3.0
```

### Step 2 — Move it to the installed PC

Copy the `.zip` **and** the `.sha256` file, side by side, into any of:

- `C:\WoodTek-ERP\installer\`
- `C:\WoodTek-ERP\`
- the Desktop
- the Downloads folder

(USB stick, network share, or email attachment all work — the checksum catches a
truncated copy.)

### Step 3 — Apply it (on the installed PC)

```
C:\WoodTek-ERP\installer\apply-update.bat      <- double-click
```

Or drag the `.zip` file onto `apply-update.bat` if you have several packs lying
around and want that exact one.

Click **Yes** on the administrator prompt. You will see it work through 8 steps:

1. **Locating the update pack** — picks the newest `WoodTek-ERP-Update-*.zip` it finds.
2. **Verifying the pack** — checks the SHA-256 checksum and reads `update.json`.
3. **Checking the installation** — confirms this PC really has WoodTek installed.
4. **Taking the pre-update snapshot** — copies `.env` and `data\` into
   `backups\update-<version>-<time>\`, and takes a database dump when
   `backup\backup-woodtek.ps1` is present. **This is your rollback copy.**
5. **Stopping the server** — ends the `\WoodTek ERP` task and frees port 3000.
6. **Installing the new files** — the old `.next\standalone` is *moved aside*
   (not deleted) so it can be put back instantly.
7. **Syncing the database schema** — re-applies `installer\schema.sql`, which
   **adds** new tables and columns and never drops or clears existing data.
8. **Starting the server and verifying health** — waits up to 90 seconds for
   `/api/health` to answer `200 OK`, then prints the build number the server
   actually reports and warns you if it does not match the pack. (A mismatch is
   almost always a browser tab showing a cached page — press **Ctrl+F5**.)

Finish:

```
UPDATE COMPLETE
  WoodTek ERP 20261005-0b83546 is running and healthy at http://localhost:3000
  Your rollback copy is kept here: C:\WoodTek-ERP\backups\update-20261005-0b83546-20261005-091512
```

---

## What an update NEVER touches

Update packs contain application files only. These stay exactly as they are, on
every update, on both paths:

| Item | Why it matters |
|---|---|
| `.env` | Holds `DATABASE_URL` and `AUTH_SECRET` — the keys to everything. Rewriting it would break logins and point the app at the wrong database. |
| `data\` | Installed edition (which module packs you bought), module/role config, and the JSON overlay. |
| `backups\` | Database dumps and snapshots. Your history. |
| `logs\` | Server logs. |
| `runtime\` | The portable Node.js the installer put there. |

Because the module list lives in `data\`, **updating never changes which modules
are installed**. To change that, re-run `WoodTek-ERP-Setup.exe` or use
`installer\configure-edition.ps1 -Addons "invoicing,cmms"`.

Your **appearance and branding** live in `data\appearance.json`, so they survive
every update too — set them once (see below) and they stay.

---

## Look & factory branding (Settings → Appearance & Branding)

One screen, two jobs:

- **App look** — **Dark** (the look the app has always had) or **Light**. Applies
  to every screen on every PC in the factory. Printed documents keep their own
  house style either way, so a light theme never turns an invoice into a black
  page.
- **Factory identity** — your factory's name, tagline, logo and contact details
  (address, phone, email, website, commercial register number). These replace
  the generic "WOODTEK / Furniture Service Center" block on **invoices, quotes,
  delivery notes, job tickets, dispatch packs, client statements, reports and
  outbound emails**, and appear next to the app name in the sidebar and on the
  sign-in screen.

The logo is resized to 256 px and stored inside `data\appearance.json` — PNG
with transparency looks best on the dark document header. Leave any field empty
and it simply does not print; with nothing set at all, documents look exactly
as they did before.

Changes need **Save appearance** and take effect immediately on the PC that made
them (the file in `data\` is shared, so other PCs pick it up on their next
restart).

---

## Which version am I running?

- **After an update:** `apply-update.bat` prints `Running build: <sha>` and warns
  you if it does not match the pack. That is the one to trust — it is read back
  from the server, not from your browser.
- **In the app:** Settings → the build stamp, bottom of the page. Same number.
- **From anywhere on the network:** <http://localhost:3000/api/health> returns
  `{"ok":true,"build":"0b83546"}`. Handy for checking a PC without walking to it.
- **On disk (installed PC):** `C:\WoodTek-ERP\update-applied.json` — the manifest
  of the pack that was applied last.
- **Inside a pack:** `update.json` at the root of the `.zip`.

The number is the **git commit** the build was made from, stamped in by
`scripts\build-prod.cjs`. So:

- it only changes when you **rebuild** after new code arrives — `git pull` alone
  does not move it;
- if it shows `dev`, the bundle was built with `npx next build` directly instead
  of `node scripts\build-prod.cjs`, and no stamp was applied;
- **`Build: 0b83546` after an update is not a failure** — it means `git pull`
  found nothing newer than commit `0b83546`. Check whether the change you are
  waiting for has actually been merged into the branch you pull from.

---

## If an update goes wrong

### The update rolled itself back

If the new server does not answer `/api/health` within 90 seconds, `apply-update`
**automatically puts the previous version back**, restarts it, and tells you:

```
  Rolled back successfully — the previous version is running again.
```

Nothing is lost. Send the window contents to support and wait for a fixed pack.

### Manual rollback (installed PC)

1. Stop the server: `schtasks /End /TN "\WoodTek ERP"`
2. Open the newest `C:\WoodTek-ERP\backups\update-*\` folder.
3. Copy `standalone-old` back to `C:\WoodTek-ERP\.next\standalone`
   (delete the new `.next\standalone` first).
4. If `.env` or `data\` were damaged, copy them back from that same folder.
5. Start the server: `schtasks /Run /TN "\WoodTek ERP"`

### Manual rollback (build PC)

Unzip your newest `backups\snapshot-*.zip` over the folder, then rebuild and
restart:

```
node scripts\build-prod.cjs
schtasks /Run /TN "\WoodTek ERP"
```

### Restoring the database

`backup\restore-woodtek.bat` restores a dump. Practise it once a quarter, on
purpose, so you *know* it works before the day you need it.

---

## Troubleshooting

| Message | What it means | What to do |
|---|---|---|
| `Checksum mismatch — the pack is incomplete` | The `.zip` was damaged in transfer (usually a USB stick pulled too early). | Copy the pack again, keeping it next to its `.sha256` file. Only use `-IgnoreChecksum` if you are certain where the pack came from. |
| `No WoodTek-ERP-Update-*.zip found` | The pack is not in a place the script looks. | Run `installer\apply-update.ps1 -UpdateZip "C:\path\to\pack.zip"`. |
| `No WoodTek ERP installation found in C:\WoodTek-ERP` | WoodTek lives somewhere else on this PC. | Run `installer\apply-update.ps1 -InstallDir "D:\WoodTek-ERP"`. |
| `The running application folder .next\standalone is locked` | A server process is still holding the files. Nothing has been changed yet. | Reboot the PC, then run the update again. |
| `Port 3000 is still in use` | Something else is listening on 3000. | Run `woodtek-free-port-3000-v2.bat` as administrator, then update again. |
| `Schema sync failed` | The new tables could not be created — usually PostgreSQL is not running. | Start the PostgreSQL service, then re-run `apply-update.bat`. Your data is untouched; the schema step only ever adds. |
| `git pull failed` | Local edits clash with the incoming code (build PC). | Do not delete anything. Send the message to support. |
| `BUILD FAILED` | The code does not compile. | Send the red text to support. The previous build still works. |

---

## Rules of thumb

- **Snapshot first.** Always. It takes 30 seconds and it has never once been a
  waste of time.
- **One pack, one PC at a time.** Apply, check the app, then move to the next PC.
- **Do not update five minutes before a shipment.** Updates stop the server.
- **Keep the last two rollback folders.** `apply-update` prunes automatically and
  keeps the 3 newest (`-KeepSnapshots 5` if you want more).
- **Never email `.env`.** It is not in git, it is not in update packs, and it is
  the only thing standing between your data and the internet.
