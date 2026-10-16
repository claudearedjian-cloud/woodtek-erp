# WoodTek dev console

A standalone page with buttons for development. It is not part of the ERP menu and is not part of the Next.js build.

- **Start:** double-click `dev-console.bat` in the repo root on the **old PC**. The page opens at http://127.0.0.1:4500. Close the console window to stop it.
- **Old PC tab:** buttons for `update-woodtek.bat`, `build-update.bat`, `build-installer.bat`, snapshots, backups, branch helpers, and checks. Helpers open in their own window, exactly as a double-click would.
- **FS200 tab:** step-by-step guides for `installer\apply-update.bat` and the other FS200 helpers. Nothing runs on FS200 from this console. Check the pack first with **Verify latest pack**.

Safety: it listens on 127.0.0.1 only, runs only the fixed actions in `server.cjs`, and refuses cross-site requests.

Test without launching anything: `DEV_CONSOLE_DRY_RUN=1 node dev-console/server.cjs`.
