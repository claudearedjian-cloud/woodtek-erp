@echo off
title WoodTek ERP (production)
cd /d %~dp0
echo [WoodTek] Starting production server...
echo [WoodTek] (Keep this window open. Press Ctrl+C to stop.)
where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
)
node start-prod.cjs
pause
