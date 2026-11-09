@echo off
title WoodTek Workflow Lab - create the side-by-side test installation
rem ===========================================================================
rem WoodTek Workflow Lab - create a SEPARATE, side-by-side installation.
rem ---------------------------------------------------------------------------
rem Double-click this file. It asks for administrator rights by itself and then
rem creates:
rem   C:\WoodTek-Workflow-Lab      (own folder, port 3001, own database)
rem   task  "\WoodTek Workflow Lab" + "WoodTek Workflow Lab Nightly Backup"
rem   firewall rule "WoodTek Workflow Lab Server"
rem   shortcuts named "WoodTek Workflow Lab"
rem
rem The existing WoodTek ERP installation (C:\WoodTek-ERP, port 3000, database
rem woodtek_erp) is NEVER stopped, rewritten, re-pointed or backed up by this.
rem The window PAUSES on every outcome, so an error is never missed.
rem
rem Details: installer\WORKFLOW-LAB.md
rem ===========================================================================
setlocal
cd /d %~dp0

echo ===========================================================================
echo   WoodTek Workflow Lab - side-by-side TEST installation
echo ===========================================================================
echo   This creates a second WoodTek installation for workflow testing.
echo   The existing installation and its database are NOT touched.
echo.

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [lab] Requesting administrator rights - click Yes on the UAC prompt...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\install-workflow-lab.ps1" %*
set "WT_RC=%ERRORLEVEL%"

if not "%WT_RC%"=="0" (
  echo.
  echo [lab] The Workflow Lab was NOT created. Exit code %WT_RC%.
  echo [lab] Read the messages above - the preflight refuses rather than guessing.
  echo [lab] Nothing was changed in the existing WoodTek ERP installation.
  echo [lab] Send a photo of this window if you need help.
  pause
  exit /b %WT_RC%
)

echo.
echo [lab] The Workflow Lab is ready.
echo [lab] Open http://localhost:3001 for the lab.
echo [lab] The existing installation is still at http://localhost:3000 and was not touched.
echo.
pause
