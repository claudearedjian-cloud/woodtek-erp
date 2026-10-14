@echo off
title WoodTek ERP - copy backups off this PC
rem ============================================================================
rem WoodTek ERP - copy the newest backups off this PC (double-click me).
rem
rem Copies the newest database dump + data zip from backups\nightly\ to a USB
rem stick or another PC. It READS the backups folder only - nothing here is
rem deleted or changed. The destination is remembered after the first time
rem (in backups\copy-offsite.txt), so later runs are one double-click.
rem
rem Anything typed after the file name is passed on. Examples:
rem   copy-backups-offsite.bat -Destination E:
rem   copy-backups-offsite.bat -All
rem   copy-backups-offsite.bat -BackupRoot D:\WoodTek-ERP\backups\nightly -Destination \\OLDPC\WoodTekBackups
rem ============================================================================
cd /d %~dp0

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0copy-backups-offsite.ps1" %*
if errorlevel 1 (
  echo.
  echo [copy] The copy did not complete - read the messages above.
  pause
  exit /b 1
)

echo.
pause
