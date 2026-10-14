@echo off
title WoodTek ERP - where are the PostgreSQL tools?
cd /d %~dp0
echo.
echo  Run this when a backup / migration / restore says
echo  "pg_dump not found" or "pg_restore was not found".
echo  It only looks and prints - the single thing it can change is one line
echo  in .env, and only if you type YES when it asks.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0find-postgres-tools.ps1"
echo.
pause
