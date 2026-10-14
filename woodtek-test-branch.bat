@echo off
title WoodTek - test a branch
rem ============================================================================
rem WoodTek ERP - put this clone on an agent branch, rebuild and restart.
rem Double-click this file INSIDE the woodtek-erp folder (the one with .git).
rem Press Enter at the prompt to use the branch the agent is working on.
rem Going back to the released version: double-click woodtek-back-to-main.bat
rem
rem It FIRST copies itself next to the Windows temp folder and does the work
rem from that copy. Windows reads a .bat file line by line BY BYTE POSITION
rem while it runs, and this script updates the folder holding this very file:
rem a rewrite mid-run makes Windows read the rest from the wrong place (garbage
rem "is not recognized" lines and false failure messages, seen 2026-10-14).
rem The temp copy cannot be rewritten while it runs.
rem ============================================================================

if "%~1"=="/staged" goto wt_staged

cd /d %~dp0

rem schtasks on the SYSTEM-run task needs admin rights - self-elevate:
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [branch] Requesting administrator rights - click Yes on the UAC prompt...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

rem The branch name the user typed (if any) travels via an environment variable,
rem because the staged working copy does not receive the original arguments.
set "WT_ARG1=%~1"

set "WT_PKG=%TEMP%\%~n0-staged.bat"
copy /y "%~f0" "%WT_PKG%" >nul
call "%WT_PKG%" /staged "%~dp0."
set "WT_RC=%errorlevel%"
del "%WT_PKG%" >nul 2>nul
exit /b %WT_RC%

:wt_staged
if "%~2"=="" (
  echo [branch] This is the updater's internal working copy.
  echo [branch] Double-click woodtek-test-branch.bat in the woodtek-erp folder instead.
  pause
  exit /b 1
)
cd /d "%~2"

if not exist ".git" (
  echo.
  echo [branch] ERROR: this folder is not a git clone ^(no .git folder^).
  echo [branch] Open the folder you normally update with update-woodtek.bat and
  echo [branch] run this file from there.
  echo.
  pause
  exit /b 1
)

rem 2026-10-07: default test branch = HR working calendar + overtime + leave
rem enforcement (session arena/265a62fe). It also contains PR #23 (HR & Payroll).
set DEFAULT_BRANCH=arena/265a62fe-woodtek-erp
set BRANCH=%WT_ARG1%
if "%BRANCH%"=="" set /p BRANCH=Branch name [press Enter for %DEFAULT_BRANCH%]: 
if "%BRANCH%"=="" set BRANCH=%DEFAULT_BRANCH%

echo.
echo [branch] Saving local config edits aside (repo version always wins)...
git checkout -- tsconfig.json next.config.ts next-env.d.ts 2>nul

rem 2026-09-30: DB dumps are no longer tracked in git (they contain customer +
rem account data) - keep the local ones in the ignored backups\ folder.
if exist "backup\*.dump" (
  if not exist "backups" mkdir "backups"
  copy /y "backup\*.dump" "backups\" >nul
  echo [branch] Kept the local DB dumps safe in backups\
)

rem ---------------------------------------------------------------------------
rem Local edits must never block an update again. On 2026-10-14 an update
rem aborted with "Your local changes to the following files would be
rem overwritten by merge" because installer files had been edited by hand on
rem this PC. From now on this script saves them FIRST: a patch copy under
rem backups\local-edits-<date>\ and a git stash entry ("git stash list" shows
rem it, "git stash pop" brings it back). Nothing is thrown away.
rem ---------------------------------------------------------------------------
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set "WT_STAMP=%%i"
if not defined WT_STAMP set "WT_STAMP=manual"
set "WT_DIRTY="
git diff --quiet
if errorlevel 1 set "WT_DIRTY=1"
git diff --cached --quiet
if errorlevel 1 set "WT_DIRTY=1"
if not defined WT_DIRTY (
  echo [branch] No local edits to set aside.
) else (
  if not exist "backups\local-edits-%WT_STAMP%" mkdir "backups\local-edits-%WT_STAMP%"
  git diff HEAD > "backups\local-edits-%WT_STAMP%\local-edits.patch"
  git status --porcelain > "backups\local-edits-%WT_STAMP%\git-status.txt"
  echo [branch] Local edits found - saved to backups\local-edits-%WT_STAMP%\local-edits.patch
  git stash push -m "local edits saved by the updater %WT_STAMP%"
  if errorlevel 1 (
    echo.
    echo [branch] Could not set the local edits aside - nothing was pulled or switched.
    echo [branch] Your edits are safe in backups\local-edits-%WT_STAMP%\
    pause
    exit /b 1
  )
  echo [branch] Local edits set aside - bring them back any time with: git stash pop
)
echo [branch] Downloading the branch list from GitHub...
git fetch origin
if errorlevel 1 (
  echo.
  echo [branch] git fetch failed - check the message above, then tell the agent.
  pause
  exit /b 1
)

echo [branch] Switching to "%BRANCH%"...
git checkout "%BRANCH%"
if errorlevel 1 (
  echo.
  echo [branch] Could not switch to "%BRANCH%" - ask the agent for the exact name.
  pause
  exit /b 1
)

echo.
echo [branch] Installing any new components (a few seconds if nothing changed)...
call npm install --no-audit --no-fund

echo.
echo [branch] Stopping the WoodTek server...
schtasks /End /TN "\WoodTek ERP"

rem Give the server a moment to release the port, then kill any leftover listener
rem (schtasks /End can orphan the actual server process).
timeout /t 2 /nobreak >nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3000 "') do taskkill /F /T /PID %%p >nul 2>&1

echo.
echo [branch] Building (1-2 minutes)...
call node scripts\build-prod.cjs
if errorlevel 1 (
  echo.
  echo [branch] BUILD FAILED - look at the error above, tell the agent, then re-run this file.
  pause
  exit /b 1
)

echo.
echo [branch] Starting the WoodTek server...
schtasks /Run /TN "\WoodTek ERP"

echo.
echo [branch] Done - you are running "%BRANCH%". Open the app and look around.
echo [branch] To go back to the released version: woodtek-back-to-main.bat
pause
