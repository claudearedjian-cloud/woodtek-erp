@echo off
rem ===========================================================================
rem WoodTek ERP - production server, SILENT (no browser, logs to file).
rem Used by the Windows scheduled task / service so the app runs in the
rem background and survives restarts. Do NOT double-click this normally.
rem ===========================================================================
cd /d %~dp0

if not exist "%~dp0logs" mkdir "%~dp0logs"

rem Older Windows (Windows 8.1 / Server 2012 R2 and below) cannot start Node.js
rem 23 and newer at all: it refuses with "Node.js is only supported on Windows
rem 10, Windows Server 2016, or higher". Skipping that platform check is the
rem workaround Node.js itself names, so the scheduled task keeps working even
rem when the runtime folder was replaced by hand. Windows 10 / Server 2016 and
rem newer always have CurrentMajorVersionNumber in the registry.
rem See RUNBOOK.txt, "OLD WINDOWS SERVERS".
set "WT_WIN_MAJOR="
for /f "tokens=3" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v CurrentMajorVersionNumber 2^>nul ^| findstr /i "REG_DWORD"') do set "WT_WIN_MAJOR=%%a"
if not defined WT_WIN_MAJOR (
  set "NODE_SKIP_PLATFORM_CHECK=1"
  echo [WoodTek] This Windows version is older than Windows 10 / Server 2016 - starting Node.js with its platform check skipped. >> "%~dp0logs\woodtek.log"
)

if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;C:\Program Files\nodejs;%PATH%"
if not exist "%~dp0runtime\node\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo [WoodTek] node.exe not found on PATH. Install Node.js. >> "%~dp0logs\woodtek.log"
  exit /b 1
)

node start-prod.cjs --no-browser >> "%~dp0logs\woodtek.log" 2>&1
set "WT_EXIT=%ERRORLEVEL%"
rem 216 = ERROR_EXE_MACHINE_TYPE_MISMATCH: Node.js refused to run on this Windows.
if "%WT_EXIT%"=="216" echo [WoodTek] Node.js refused to start because this Windows version is older than Windows 10 / Server 2016. See RUNBOOK.txt, "OLD WINDOWS SERVERS". >> "%~dp0logs\woodtek.log"
