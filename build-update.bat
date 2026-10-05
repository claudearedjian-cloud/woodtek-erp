@echo off
title WoodTek ERP - Build update pack
cd /d %~dp0
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
