@echo off
rem ===========================================================================
rem WoodTek Workflow Lab - refresh the lab application files
rem ---------------------------------------------------------------------------
rem Re-runs the Workflow Lab installer in Refresh mode on THIS folder:
rem   - stops only the task "WoodTek Workflow Lab"
rem   - copies fresh application files in (never over this folder's .env or data)
rem   - restarts only the lab and checks /api/health on the lab port
rem The existing WoodTek ERP installation and its database are not touched.
rem Needs administrator rights (the lab runs as a SYSTEM scheduled task and the
rem Windows Firewall rule belongs to the machine), so it asks for them itself.
rem ===========================================================================
title WoodTek Workflow Lab - refresh
setlocal

net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [lab] Requesting administrator rights - click Yes on the UAC prompt...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo ===========================================================================
echo   WoodTek Workflow Lab - refreshing the lab application files
echo   Only the lab folder, the lab task and the lab firewall rule are touched.
echo ===========================================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\install-workflow-lab.ps1" -Action Refresh -TargetDir "%~dp0."
set "WT_RC=%ERRORLEVEL%"
if not "%WT_RC%"=="0" (
  echo.
  echo [lab] Refresh FAILED with exit code %WT_RC%.
  echo [lab] Read the messages above - nothing was changed in the factory installation.
  pause
  exit /b %WT_RC%
)
echo.
echo [lab] Refresh finished. Open http://localhost:3001 to see the lab.
pause
