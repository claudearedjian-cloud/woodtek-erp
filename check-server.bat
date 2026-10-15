@echo off
title WoodTek ERP - server check
rem ============================================================================
rem WoodTek ERP - server check - just double-click me.
rem
rem Shows: the app folder, the database name, the PostgreSQL version, the row
rem counts that prove the factory data is present, and /api/health.
rem It only READS - nothing on this PC is changed.
rem
rem 2026-10-15 - the first version of this file worked on the developer PC but
rem not on the factory server. It was the only shipped helper that used
rem internal jump labels and the only one that printed round brackets inside
rem if-blocks. The cmd.exe of that Windows version (Server 2012 R2) refused to
rem parse it - "... was unexpected at this time" - and the window closed
rem before printing a single line. This version is deliberately straight-line:
rem no labels, no if-blocks and no brackets in its messages, the same shape as
rem show-server-check.bat, which is proven on that server. render-test.js now
rem refuses to build a pack containing a helper with either construct, so this
rem rule is enforced, not remembered.
rem
rem The same three Node.js places are checked, in the same order.
rem ============================================================================
cd /d %~dp0

set "WT_NODE="
set "WT_RC=0"

rem --- 1. the app's own runtime, installed together with WoodTek ERP --------
if not defined WT_NODE if exist "%~dp0runtime\node\node.exe" "%~dp0runtime\node\node.exe" --version >nul 2>nul
if not defined WT_NODE if exist "%~dp0runtime\node\node.exe" if not errorlevel 1 set "WT_NODE=%~dp0runtime\node\node.exe"

rem --- 2. the standard Node.js install folder -------------------------------
if not defined WT_NODE if exist "%ProgramFiles%\nodejs\node.exe" "%ProgramFiles%\nodejs\node.exe" --version >nul 2>nul
if not defined WT_NODE if exist "%ProgramFiles%\nodejs\node.exe" if not errorlevel 1 set "WT_NODE=%ProgramFiles%\nodejs\node.exe"

rem --- 3. wherever PATH points ----------------------------------------------
if not defined WT_NODE for /f "delims=" %%n in ('where node 2^>nul') do if not defined WT_NODE set "WT_NODE=%%n"

rem --- 4. nothing worked yet: retry with Node.js' own escape hatch ----------
if not defined WT_NODE set "NODE_SKIP_PLATFORM_CHECK=1"
if not defined WT_NODE if exist "%~dp0runtime\node\node.exe" set "WT_NODE=%~dp0runtime\node\node.exe"
if not defined WT_NODE if exist "%ProgramFiles%\nodejs\node.exe" set "WT_NODE=%ProgramFiles%\nodejs\node.exe"
if not defined WT_NODE for /f "delims=" %%n in ('where node 2^>nul') do if not defined WT_NODE set "WT_NODE=%%n"

if not defined WT_NODE echo [check] No usable Node.js found on this PC.
if not defined WT_NODE echo [check] Reinstall WoodTek ERP with its setup file, or tell the agent.
if not defined WT_NODE pause
if not defined WT_NODE exit /b 1

echo [check] Using Node.js: %WT_NODE%
"%WT_NODE%" "%~dp0check-server.js"
set "WT_RC=%errorlevel%"

rem 216 = ERROR_EXE_MACHINE_TYPE_MISMATCH: Node.js refused to run on this
rem Windows version and named its own escape hatch - try once more with it.
if "%WT_RC%"=="216" echo [check] This Windows refused that Node.js. Retrying with NODE_SKIP_PLATFORM_CHECK=1...
if "%WT_RC%"=="216" set "NODE_SKIP_PLATFORM_CHECK=1"
if "%WT_RC%"=="216" "%WT_NODE%" "%~dp0check-server.js"
if "%WT_RC%"=="216" set "WT_RC=%errorlevel%"

echo [check] exit code: %WT_RC%
echo.
pause
exit /b %WT_RC%
