@echo off
cd /d C:\woodtek-erp

:: Use tokens=* to properly capture folder names containing spaces
set "LATEST_BACKUP="
rem 2026-10-15: straight-line (no jump label, no block). cmd.exe finds labels
rem by counting bytes, which is how check-server.bat died on the factory
rem server. /o-d lists newest first, so the first row that arrives wins.
for /f "tokens=*" %%I in ('dir "C:\WoodTekBackups\WoodTek_*" /b /ad /o-d 2^>nul') do if not defined LATEST_BACKUP set "LATEST_BACKUP=C:\WoodTekBackups\%%I"
if "%LATEST_BACKUP%"=="" (
    echo [ERROR] No backups found in C:\WoodTekBackups
    pause
    exit /b
)

echo [INFO] Found latest backup: "%LATEST_BACKUP%"
echo [INFO] Starting automatic restore...
echo.

:: Added -Force parameter to bypass the confirmation prompt automatically
powershell -ExecutionPolicy Bypass -File .\scripts\restore-windows.ps1 -BackupPackage "%LATEST_BACKUP%" -Force

pause
