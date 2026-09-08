@echo off
title WoodTek snapshot
rem ===========================================================================
rem WoodTek ERP - pre-change snapshot.
rem Zips source + configs + .env with a date stamp into backups\.
rem Run BEFORE applying any modification. Rollback = unzip over the folder,
rem then: node scripts\build-prod.cjs  and restart the server.
rem ===========================================================================
cd /d %~dp0
if not exist backups mkdir backups
powershell -NoProfile -Command "$s = Get-Date -Format 'yyyyMMdd-HHmm'; $items = @('src', '.env', 'start-prod.cjs', 'start-woodtek-prod.bat', 'start-woodtek-prod-silent.bat', 'start-woodtek-dev-lan.bat', 'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'drizzle', 'scripts') | Where-Object { Test-Path $_ }; $dst = 'backups\snapshot-' + $s + '.zip'; Compress-Archive -Path $items -DestinationPath $dst; Write-Host ('SAVED: ' + (Resolve-Path $dst))"
echo.
pause
