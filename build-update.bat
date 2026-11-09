@echo off
title WoodTek ERP - Build update pack
rem ============================================================================
rem WoodTek ERP - sync merged main and build an update pack for the factory server.
rem Double-click me ON THE DEVELOPMENT PC (the old PC). I safely fast-forward
rem main, install the locked dependencies, build the pack, and restart the local
rem server if it was running. No separate code-pull step is needed after this
rem helper has been updated on the old PC.
rem
rem This helper runs from a temp copy before syncing because Git may replace
rem this very .bat file while cmd.exe reads it by byte position.
rem It asks for administrator rights by itself (click Yes on the UAC prompt):
rem the build must stop the local WoodTek server to replace app files.
rem ============================================================================
setlocal EnableExtensions EnableDelayedExpansion

if not "%~1"=="/staged" (
  cd /d "%~dp0"
  net session >nul 2>&1
  if errorlevel 1 (
    echo [build] Requesting administrator rights - click Yes on the UAC prompt...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
  )
  set "WT_PKG=%TEMP%\%~n0-staged.bat"
  copy /y "%~f0" "!WT_PKG!" >nul
  if errorlevel 1 (
    echo [ERROR] Could not stage a safe temporary copy of this helper.
    pause
    exit /b 1
  )
  call "!WT_PKG!" /staged "%~dp0."
  set "WT_RC=!errorlevel!"
  del "!WT_PKG!" >nul 2>nul
  exit /b !WT_RC!
)

if "%~2"=="" (
  echo [ERROR] This is the helper's internal working copy.
  echo Double-click build-update.bat in the woodtek-erp source folder instead.
  pause
  exit /b 1
)
cd /d "%~2"

echo ============================================================================
echo   WoodTek ERP - Syncing main and building update pack
echo   Output: dist-update\WoodTek-ERP-Update-VERSION.zip
echo ============================================================================
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~2\installer\build-update.ps1" -SyncMain
if errorlevel 1 (
  echo.
  echo [ERROR] Update pack build failed. See messages above.
  pause
  exit /b 1
)
echo.
pause
