@echo off
title WoodTek ERP - Build Windows .exe Installer
rem ============================================================================
rem WoodTek ERP - build the turnkey Windows .exe installer.
rem
rem It asks for administrator rights by itself (click Yes on the UAC prompt):
rem the build has to STOP the running WoodTek server to replace the app files,
rem and that server runs as a background SYSTEM task - only an elevated window
rem can stop it (see build-update.bat for the 2026-10-14 "Port 3000 is STILL
rem occupied" story).
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
echo   WoodTek ERP - Building Turnkey Windows .exe Installer
echo   Output: dist-installer\WoodTek-ERP-Setup.exe
echo ============================================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\build-installer.ps1" %*
if errorlevel 1 (
  echo.
  echo [ERROR] Installer build failed. See messages above.
  pause
  exit /b 1
)
echo.
pause
