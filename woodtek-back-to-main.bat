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
