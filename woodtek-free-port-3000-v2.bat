@echo off
title WoodTek - free port 3000 (v2)
if not exist "%~dp0woodtek-free-port-3000-v2.ps1" (
  echo Put woodtek-free-port-3000-v2.ps1 in the same folder as this .bat, then run again.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0woodtek-free-port-3000-v2.ps1"
echo.
pause
