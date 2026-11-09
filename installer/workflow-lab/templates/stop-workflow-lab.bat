@echo off
rem ===========================================================================
rem WoodTek Workflow Lab - stop ONLY the lab
rem ---------------------------------------------------------------------------
rem Ends the scheduled task "WoodTek Workflow Lab" and kills whatever listens on
rem the LAB port (read from this folder's .env). The task name and the port are
rem both lab-specific, so the existing WoodTek ERP installation is not touched.
rem ===========================================================================
title WoodTek Workflow Lab - stop
setlocal

set "WT_PORT="
for /f "tokens=2 delims==" %%a in ('findstr /b /i "PORT=" "%~dp0.env" 2^>nul') do set "WT_PORT=%%a"
if not defined WT_PORT set "WT_PORT=3001"

echo [lab] Stopping the scheduled task "WoodTek Workflow Lab"...
schtasks /End /TN "\WoodTek Workflow Lab" >nul 2>&1
timeout /t 2 /nobreak >nul

echo [lab] Freeing the lab port %WT_PORT% if something still holds it...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%WT_PORT% "') do taskkill /F /T /PID %%p >nul 2>&1

echo [lab] Done. The existing WoodTek ERP installation on port 3000 was not touched.
pause
