@echo off
title WoodTek update
rem ===========================================================================
rem WoodTek ERP — one-click update.
rem Pulls the latest code from GitHub, stops the server, rebuilds, restarts.
rem Double-click AFTER the agent says "pushed". Never paste command sequences.
rem ===========================================================================
cd /d %~dp0

echo [update] Pulling latest code from GitHub...
rem Repo files that builds/edits may dirty locally — repo version always wins:
git checkout -- tsconfig.json next.config.ts next-env.d.ts 2>nul
git pull
if errorlevel 1 (
  echo [update] git pull failed — check the message above.
  pause
  exit /b 1
)

echo.
echo [update] Stopping the WoodTek server...
schtasks /End /TN "\WoodTek ERP"

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
