@echo off
title WoodTek ERP - server check
rem ============================================================================
rem WoodTek ERP - server check (double-click me).
rem
rem Runs check-server.js and shows: the app folder, the database version,
rem row counts that prove the factory data is present, and /api/health.
rem It only READS - nothing on this PC is changed.
rem
rem Node.js: modern Node.js (23+) refuses to start on Windows 8.1 / Server
rem 2012 R2 and exits with a message about Windows 10. That is why every
rem candidate node.exe is probed once ("node --version") before it is used,
rem the app's OWN runtime (runtime\node, installed with the app) always comes
rem first, and the last resort is Node.js' own escape hatch,
rem NODE_SKIP_PLATFORM_CHECK=1. See RUNBOOK.txt, "OLD WINDOWS SERVERS".
rem ============================================================================
cd /d %~dp0

set "WT_NODE="
call :probeall

if not defined WT_NODE (
  echo [check] No node.exe would start on this Windows version.
  echo [check] Retrying with Node.js' own escape hatch (NODE_SKIP_PLATFORM_CHECK=1)...
  set "NODE_SKIP_PLATFORM_CHECK=1"
  call :probeall
)

if not defined WT_NODE (
  echo.
  echo [check] No usable Node.js found. Looked for:
  echo [check]   %~dp0runtime\node\node.exe   (the app's own runtime)
  echo [check]   %ProgramFiles%\nodejs\node.exe
  echo [check]   wherever PATH points
  echo [check] Tell the agent, or reinstall WoodTek ERP with its setup file.
  pause
  exit /b 1
)

echo [check] Using Node.js: %WT_NODE%
"%WT_NODE%" "%~dp0check-server.js"
set "WT_RC=%errorlevel%"
echo.
pause
exit /b %WT_RC%

rem ---------------------------------------------------------------------------
rem Probe order: the app's own runtime first (it always matches this Windows),
rem then the standard Node.js install folder, then whatever 'where' finds.
rem ---------------------------------------------------------------------------
:probeall
if not defined WT_NODE if exist "%~dp0runtime\node\node.exe" call :trynode "%~dp0runtime\node\node.exe"
if not defined WT_NODE if exist "%ProgramFiles%\nodejs\node.exe" call :trynode "%ProgramFiles%\nodejs\node.exe"
if not defined WT_NODE for /f "delims=" %%n in ('where node 2^>nul') do if not defined WT_NODE call :trynode "%%n"
exit /b 0

:trynode
"%~1" --version >nul 2>nul
if errorlevel 1 exit /b 0
set "WT_NODE=%~1"
exit /b 0
