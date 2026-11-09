@echo off
rem ===========================================================================
rem WoodTek Workflow Lab - start the lab server in this window
rem ---------------------------------------------------------------------------
rem This helper belongs to the SIDE-BY-SIDE Workflow Lab installation only.
rem It starts the server from THIS folder, so it uses this folder's .env
rem (lab port 3001, lab database woodtek_workflow_lab) and never touches the
rem existing WoodTek ERP installation.
rem ===========================================================================
title WoodTek Workflow Lab
cd /d %~dp0

if not exist "%~dp0logs" mkdir "%~dp0logs"
if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;C:\Program Files\nodejs;%PATH%"
if not exist "%~dp0runtime\node\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo [lab] node.exe was not found. Install Node.js 22 LTS, or run the lab installer again.
  pause
  exit /b 1
)

echo [lab] Starting the WoodTek Workflow Lab server from this folder.
echo [lab] The port and database come from this folder's .env - not from the existing installation.
echo [lab] Keep this window open. Press Ctrl+C to stop.
echo.
node start-prod.cjs
echo.
echo [lab] The Workflow Lab server has stopped.
pause
