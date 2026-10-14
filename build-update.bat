@echo off
title WoodTek ERP - Build update pack
rem ============================================================================
rem WoodTek ERP - build an update pack for the factory server.
rem Double-click me ON THE DEVELOPMENT PC (the old PC), after update-woodtek.bat
rem has pulled the newest code.
rem
rem It asks for administrator rights by itself (click Yes on the UAC prompt):
rem the build has to STOP the running WoodTek server to replace the app files,
rem and that server runs as a background SYSTEM task - only an elevated window
rem can stop it. Without those rights the build stops at
rem "Port 3000 is STILL occupied" (exactly what happened on 2026-10-14).
rem ============================================================================
cd /d %~dp0

rem schtasks on the SYSTEM-run task needs admin rights - self-elevate:
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [build] Requesting administrator rights - click Yes on the UAC prompt...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo ============================================================================
echo   WoodTek ERP - Building update pack
echo   Output: dist-update\WoodTek-ERP-Update-VERSION.zip
echo ============================================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\build-update.ps1" %*
if errorlevel 1 (
  echo.
  echo [ERROR] Update pack build failed. See messages above.
  pause
  exit /b 1
)
echo.
pause
