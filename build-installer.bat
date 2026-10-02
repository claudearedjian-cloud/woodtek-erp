@echo off
title WoodTek ERP — Build Windows .exe Installer
cd /d %~dp0
echo ============================================================================
echo   WoodTek ERP — Building Turnkey Windows .exe Installer
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
