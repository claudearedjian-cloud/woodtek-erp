@echo off
rem ===========================================================================
rem WoodTek ERP — production server, SILENT (no browser, logs to file).
rem Used by the Windows scheduled task / service so the app runs in the
rem background and survives restarts. Do NOT double-click this normally.
rem ===========================================================================
cd /d %~dp0

if not exist "%~dp0logs" mkdir "%~dp0logs"

set "PATH=C:\Program Files\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo [WoodTek] node.exe not found on PATH. Install Node.js. >> "%~dp0logs\woodtek.log"
  exit /b 1
)

node start-prod.cjs --no-browser >> "%~dp0logs\woodtek.log" 2>&1
