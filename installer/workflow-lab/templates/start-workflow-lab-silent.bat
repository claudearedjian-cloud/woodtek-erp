@echo off
rem ===========================================================================
rem WoodTek Workflow Lab - SILENT server (used by the lab scheduled task)
rem ---------------------------------------------------------------------------
rem Started at boot by the Windows scheduled task "WoodTek Workflow Lab".
rem Logs to logs\woodtek-workflow-lab.log in THIS folder. Do not double-click
rem this file normally - use start-workflow-lab.bat instead.
rem ===========================================================================
cd /d %~dp0

if not exist "%~dp0logs" mkdir "%~dp0logs"

rem Older Windows (Windows 8.1 / Server 2012 R2 and below) cannot start
rem Node.js 23 and newer at all. Same workaround as the factory installation:
rem skip the platform check on those Windows versions only.
set "WT_WIN_MAJOR="
for /f "tokens=3" %%a in ('reg query "HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion" /v CurrentMajorVersionNumber 2^>nul ^| findstr /i "REG_DWORD"') do set "WT_WIN_MAJOR=%%a"
if not defined WT_WIN_MAJOR (
  set "NODE_SKIP_PLATFORM_CHECK=1"
  echo [lab] This Windows version is older than Windows 10 / Server 2016 - starting Node.js with its platform check skipped. >> "%~dp0logs\woodtek-workflow-lab.log"
)

if exist "%~dp0runtime\node\node.exe" set "PATH=%~dp0runtime\node;C:\Program Files\nodejs;%PATH%"
if not exist "%~dp0runtime\node\node.exe" set "PATH=C:\Program Files\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo [lab] node.exe not found on PATH. Install Node.js. >> "%~dp0logs\woodtek-workflow-lab.log"
  exit /b 1
)

node start-prod.cjs --no-browser >> "%~dp0logs\woodtek-workflow-lab.log" 2>&1
