@echo off
title WoodTek - back to released version (main)
rem ============================================================================
rem WoodTek ERP - leave the test branch and return to the released version.
rem Double-click this file INSIDE the woodtek-erp folder (the one with .git).
rem ============================================================================
cd /d %~dp0

rem schtasks on the SYSTEM-run task needs admin rights - self-elevate:
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [branch] Requesting administrator rights - click Yes on the UAC prompt...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

if not exist ".git" (
  echo.
  echo [branch] ERROR: this folder is not a git clone ^(no .git folder^).
  echo.
  pause
  exit /b 1
)

echo [branch] Saving local config edits aside (repo version always wins)...
git checkout -- tsconfig.json next.config.ts next-env.d.ts 2>nul

if exist "backup\*.dump" (
  if not exist "backups" mkdir "backups"
  copy /y "backup\*.dump" "backups\" >nul
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

echo [branch] Switching back to main...
git checkout main
if errorlevel 1 (
  echo.
  echo [branch] Could not switch to main - check the message above.
  pause
  exit /b 1
)
git pull
if errorlevel 1 (
  echo.
  echo [branch] git pull failed - check the message above.
  pause
  exit /b 1
)

echo.
echo [branch] Installing any new components (a few seconds if nothing changed)...
call npm install --no-audit --no-fund

echo.
echo [branch] Stopping the WoodTek server...
schtasks /End /TN "\WoodTek ERP"
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
echo [branch] Done - you are back on the released version (main).
pause
