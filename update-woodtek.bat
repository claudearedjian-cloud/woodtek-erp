@echo off
title WoodTek update
rem ===========================================================================
rem WoodTek ERP — one-click update.
rem Pulls the latest code from GitHub, stops the server, rebuilds, restarts.
rem Double-click AFTER the agent says "pushed". Never paste command sequences.
rem ===========================================================================
cd /d %~dp0

rem schtasks on the SYSTEM-run task needs admin rights — self-elevate:
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [update] Requesting administrator rights — click Yes on the UAC prompt...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

echo [update] Pulling latest code from GitHub...
rem Repo files that builds/edits may dirty locally — repo version always wins:
git checkout -- tsconfig.json next.config.ts next-env.d.ts 2>nul

rem 2026-09-30: DB dumps are no longer tracked in git (they contain customer +
rem account data). Git would DELETE the old tracked dumps from this folder on
rem pull — copy them to the ignored backups\ folder first so nothing is lost.
if exist "backup\*.dump" (
  if not exist "backups" mkdir "backups"
  copy /y "backup\*.dump" "backups\" >nul
  echo [update] Kept the local DB dumps safe in backups\
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
  echo [update] No local edits to set aside.
) else (
  if not exist "backups\local-edits-%WT_STAMP%" mkdir "backups\local-edits-%WT_STAMP%"
  git diff HEAD > "backups\local-edits-%WT_STAMP%\local-edits.patch"
  git status --porcelain > "backups\local-edits-%WT_STAMP%\git-status.txt"
  echo [update] Local edits found - saved to backups\local-edits-%WT_STAMP%\local-edits.patch
  git stash push -m "local edits saved by the updater %WT_STAMP%"
  if errorlevel 1 (
    echo.
    echo [update] Could not set the local edits aside - nothing was pulled or switched.
    echo [update] Your edits are safe in backups\local-edits-%WT_STAMP%\
    pause
    exit /b 1
  )
  echo [update] Local edits set aside - bring them back any time with: git stash pop
)
git pull
if errorlevel 1 (
  echo [update] git pull failed — check the message above.
  pause
  exit /b 1
)

echo.
echo [update] Installing any new components (takes a few seconds if nothing changed)...
call npm install --no-audit --no-fund

echo.
echo [update] Stopping the WoodTek server...
schtasks /End /TN "\WoodTek ERP"

rem Give the server a moment to release the port, then kill any leftover listener
rem (schtasks /End can orphan the actual server process).
timeout /t 2 /nobreak >nul
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":3000 "') do taskkill /F /T /PID %%p >nul 2>&1

echo.
echo [update] Building (1-2 minutes)...
call node scripts\build-prod.cjs
if errorlevel 1 (
  echo.
  echo [update] BUILD FAILED — look at the error above, tell the agent, then re-run this file.
  pause
  exit /b 1
)

echo.
echo [update] Starting the WoodTek server...
schtasks /Run /TN "\WoodTek ERP"

echo.
echo [update] Done. Open the app and check your change.
pause
