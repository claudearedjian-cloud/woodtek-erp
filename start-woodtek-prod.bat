@echo off
title WoodTek ERP (production)
cd /d %~dp0

rem ---------------------------------------------------------------------------
rem Older Windows (Windows 8.1 / Server 2012 R2 and below) cannot start Node.js
rem 23 and newer at all: it prints "Node.js is only supported on Windows 10,
rem Windows Server 2016, or higher" and exits without running the server.
rem Skipping that platform check is the workaround Node.js itself names in that
rem message, so it is set here for those Windows versions only. Windows 10 /
rem Server 2016 and newer always have CurrentMajorVersionNumber in the
rem registry; older versions do not.
rem A fresh install on such a server bundles Node.js 22 LTS, which starts on its
rem own - see RUNBOOK.txt, "OLD WINDOWS SERVERS".
rem ---------------------------------------------------------------------------
set "WT_WIN_MAJOR="
for /f "tokens=3" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v CurrentMajorVersionNumber 2^>nul ^| findstr /i "REG_DWORD"') do set "WT_WIN_MAJOR=%%a"
if not defined WT_WIN_MAJOR (
  set "NODE_SKIP_PLATFORM_CHECK=1"
  echo [WoodTek] NOTE: this Windows version is older than Windows 10 / Server 2016.
  echo [WoodTek] Node.js is starting with its platform check skipped so it can run.
  echo [WoodTek] See RUNBOOK.txt - "OLD WINDOWS SERVERS" if anything looks wrong.
)

echo [WoodTek] Starting production server...
echo [WoodTek] (Keep this window open. Press Ctrl+C to stop.)
if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  if exist "C:\Program Files\nodejs\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
)
node start-prod.cjs
set "WT_EXIT=%ERRORLEVEL%"
rem 216 = ERROR_EXE_MACHINE_TYPE_MISMATCH, the code Node.js exits with when it
rem refuses to run on this Windows version (it prints the reason above).
if "%WT_EXIT%"=="216" (
  echo.
  echo [WoodTek] Node.js refused to start because this Windows version is older
  echo [WoodTek] than Windows 10 / Server 2016. See RUNBOOK.txt - "OLD WINDOWS SERVERS".
)
pause
