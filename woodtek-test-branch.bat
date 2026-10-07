@echo off
title WoodTek - test a branch
rem ============================================================================
rem WoodTek ERP - put this clone on an agent branch, rebuild and restart.
rem Double-click this file INSIDE the woodtek-erp folder (the one with .git).
rem Press Enter at the prompt to use the branch the agent is working on.
rem Going back to the released version: double-click woodtek-back-to-main.bat
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
  echo [branch] Open the folder you normally update with update-woodtek.bat and
  echo [branch] run this file from there.
  echo.
  pause
  exit /b 1
)

set DEFAULT_BRANCH=arena/b4a6a687-woodtek-erp
set BRANCH=%~1
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
