@echo off
title Inspect WoodTek database backup
cd /d "%~dp0"
echo ============================================================================
echo   WoodTek ERP - Read-only database backup inspector
echo   This reads the selected dump only. It does not restore or connect to a database.
echo ============================================================================
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0scripts\inspect-db-dump.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Backup inspection failed. See messages above.
)
echo.
pause
