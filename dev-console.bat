@echo off
title WoodTek dev console
rem ============================================================================
rem WoodTek ERP - standalone development console (old PC only).
rem Double-click me on the DEVELOPMENT PC. It starts a local page at
rem http://127.0.0.1:4500 in your browser. Close this window to stop it.
rem It is not part of the ERP menu, and it never runs on FS200.
rem ============================================================================
cd /d %~dp0
where node >nul 2>&1
if errorlevel 1 (
  echo [console] Node.js was not found on this PC. Install Node.js, then try again.
  pause
  exit /b 1
)
node "%~dp0dev-console\server.cjs"
pause
