@echo off
rem ===========================================================================
rem WoodTek Workflow Lab - health check (read-only)
rem ---------------------------------------------------------------------------
rem Shows the lab folder, its database and its port from THIS folder's .env and
rem probes http://localhost:<lab port>/api/health. Uses the same check script as
rem the factory installation, so it never looks at the factory installation.
rem ===========================================================================
title WoodTek Workflow Lab - check
cd /d %~dp0

if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;C:\Program Files\nodejs;%PATH%"
if not exist "%~dp0runtime\node\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo [lab] node.exe was not found, so the check cannot run.
  pause
  exit /b 1
)

node check-server.js
echo.
echo [lab] Reminder: the factory installation answers on port 3000, the lab on 3001.
pause
