@echo off
title WoodTek ERP - Apply update
rem ============================================================================
rem WoodTek ERP - apply an update pack to this PC.
rem
rem Just double-click this file. It asks for administrator rights by itself.
rem
rem Where the pack can sit (the newest WoodTek-ERP-Update-*.zip wins):
rem   this installer folder, the app folder, the Desktop, or Downloads.
rem
rem To apply one exact pack: drag the .zip file onto this .bat,
rem or run:  installer\apply-update.ps1 -UpdateZip "C:\path\to\pack.zip"
rem
rem What is NEVER touched: .env, data\, backups\, logs\, runtime\
rem A rollback copy is taken first - if the new version does not come up
rem healthy within 90 seconds, this puts the old one back automatically.
rem ============================================================================
cd /d %~dp0

if "%~1"=="" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-update.ps1"
) else (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0apply-update.ps1" -UpdateZip "%~1"
)

if errorlevel 1 (
  echo.
  echo [ERROR] The update did not complete. Read the messages above.
  echo         Nothing was lost - see UPDATING.md, section "If an update goes wrong".
  pause
  exit /b 1
)

echo.
pause
