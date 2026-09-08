@echo off
title WoodTek git setup
rem ===========================================================================
rem WoodTek ERP - one-time git setup.
rem Creates .gitignore, initializes a local repo, makes the first commit.
rem .env is deliberately NOT committed (it holds secrets) - it lives in your
rem snapshots and backups instead.
rem ===========================================================================
cd /d %~dp0
where git >nul 2>nul || (
  echo Git is not installed.
  echo Download and install it with default options from: https://git-scm.com/download/win
  echo Then run this file again.
  pause
  exit /b 1
)
if not exist .gitignore (
  (
    echo node_modules/
    echo .next/
    echo logs/
    echo backups/
    echo *.log
    echo *.bak
    echo .env
    echo src/src/
  ) > .gitignore
  echo Created .gitignore
)
git init
git add -A
git commit -m "WoodTek ERP baseline - %date% %time%"
echo.
echo Local repository ready.
echo Now create a PRIVATE repo on https://github.com (name: woodtek-erp), then run:
echo   git remote add origin https://github.com/YOUR-USERNAME/woodtek-erp.git
echo   git push -u origin master
echo.
echo After every successful change from now on:
echo   git add -A
echo   git commit -m "short description of the change"
pause
