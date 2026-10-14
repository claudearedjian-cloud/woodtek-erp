@echo off
title WoodTek - unblock the update (save hand edits, then pull)
rem ============================================================================
rem WHEN TO USE THIS
rem   "git pull failed" / "Your local changes to the following files would be
rem   overwritten by merge" - i.e. files were edited by hand on this PC and the
rem   running updater is too old to set them aside by itself.
rem
rem WHAT IT DOES
rem   1. shows what is edited
rem   2. saves a plain-text copy of those edits to backups\local-edits-<date>\
rem   3. sets them aside with "git stash" (recoverable: git stash list)
rem   4. pulls the newest released code
rem
rem After this update, update-woodtek.bat / woodtek-back-to-main.bat do all of
rem this by themselves, so this file is only needed once (or after a very old
rem copy of the updater is in use).
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

set "WT_PKG=%TEMP%\%~n0-staged.bat"
copy /y "%~f0" "%WT_PKG%" >nul
call "%WT_PKG%" /staged "%~dp0."
set "WT_RC=%errorlevel%"
del "%WT_PKG%" >nul 2>nul
exit /b %WT_RC%

:wt_staged
if "%~2"=="" (
  echo [unblock] This is the updater's internal working copy.
  echo [unblock] Double-click unblock-update.bat in the woodtek-erp folder instead.
  pause
  exit /b 1
)
cd /d "%~2"

if not exist ".git" (
  echo.
  echo [unblock] ERROR: this folder is not a git clone ^(no .git folder^).
  echo [unblock] Put this file next to update-woodtek.bat ^(the folder with .git^) and run it there.
  echo.
  pause
  exit /b 1
)

echo.
echo [unblock] Files changed by hand on this PC:
echo.
git status --short
echo.

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set "STAMP=%%i"
if not defined STAMP set "STAMP=manual"
set "SAVEDIR=backups\local-edits-%STAMP%"
if not exist "%SAVEDIR%" mkdir "%SAVEDIR%"

echo [unblock] Saving a copy of those edits to %SAVEDIR% ...
git diff HEAD > "%SAVEDIR%\local-edits.patch"
git status --porcelain > "%SAVEDIR%\git-status.txt"
echo [unblock]   local-edits.patch  ^(plain text - open it in Notepad any time^)
echo.

set "ANSWER="
set /p ANSWER=  Continue? The edited files are set aside (not deleted). Type YES: 
if /I not "%ANSWER%"=="YES" (
  echo.
  echo [unblock] Stopped. Nothing was changed.
  pause
  exit /b 1
)

echo.
echo [unblock] Setting the edits aside ...
git stash push -m "local edits before update %STAMP%"
if errorlevel 1 (
  echo.
  echo [unblock] Could not set the edits aside - nothing was pulled.
  echo [unblock] Your edits are safe in %SAVEDIR% - send that patch to the agent.
  pause
  exit /b 1
)

echo.
echo [unblock] Pulling the newest released code ...
git pull
if errorlevel 1 (
  echo.
  echo [unblock] git pull still failed - send a photo of this window to the agent.
  echo [unblock] Your edits are safe in %SAVEDIR%\local-edits.patch
  pause
  exit /b 1
)

echo.
echo [unblock] Done. This PC now has the newest released code:
git log --oneline -5
echo.
echo [unblock] Your edits are kept as:
echo [unblock]   %SAVEDIR%\local-edits.patch   ^(a record^)
echo [unblock]   git stash list                ^(the recoverable copy^)
echo [unblock] Do NOT run "git stash pop" for now - the update already carries
echo [unblock] those fixes and more. Send the patch file to the agent instead.
echo.
echo [unblock] NEXT: double-click build-installer.bat  ^(or woodtek-back-to-main.bat^).
echo.
pause
