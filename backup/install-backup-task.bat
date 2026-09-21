@echo off
title WoodTek nightly backup installer
rem ===========================================================================
rem WoodTek ERP - install the nightly backup scheduled task.
rem
rem Creates the "WoodTek Nightly Backup" task (daily at 01:30) which dumps
rem the Postgres database and zips the JSON data overlay into
rem backups\nightly\ with 14-day retention.
rem
rem Double-click and click Yes on the UAC prompt. The FIRST backup runs
rem immediately at the end, so you can verify it before leaving the machine.
rem ===========================================================================
cd /d "%~dp0.."

rem schtasks needs admin rights - self-elevate (same pattern as update-woodtek.bat):
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [backup] Requesting administrator rights - click Yes on the UAC prompt...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo [backup] Creating the scheduled task "WoodTek Nightly Backup" (daily 01:30)...
schtasks /Create /F /TN "WoodTek Nightly Backup" /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"%~dp0backup-woodtek.ps1\"" /SC DAILY /ST 01:30
if errorlevel 1 (
  echo [backup] FAILED to create the scheduled task - check the message above.
  pause
  exit /b 1
)

echo.
echo [backup] Running the first backup now - this verifies pg_dump and the data zip...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0backup-woodtek.ps1"
if errorlevel 1 (
  echo.
  echo [backup] The scheduled task exists, but the first backup FAILED.
  echo [backup] Read backups\nightly\backup-woodtek.log and tell the agent the exact line.
  pause
  exit /b 1
)

echo.
echo [backup] OK. Nightly backups now land in:
echo [backup]   %~dp0..\backups\nightly\   (db-*.dump + data-*.zip, 14-day retention)
echo.
pause
