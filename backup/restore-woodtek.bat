@echo off
cd /d C:\woodtek-erp

:: Use tokens=* to properly capture folder names containing spaces
set "LATEST_BACKUP="
for /f "tokens=*" %%I in ('dir "C:\WoodTekBackups\WoodTek_*" /b /ad /o-d 2^>nul') do (
    set "LATEST_BACKUP=C:\WoodTekBackups\%%I"
    goto :FoundLatest
)

:FoundLatest
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
