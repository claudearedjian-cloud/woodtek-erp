@echo off
title WoodTek ERP - prepare the data for the new server
cd /d %~dp0
echo.
echo  This collects your factory data into a folder you can copy to the
echo  new server. It only reads and copies - nothing here is changed.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0prepare-migration.ps1"
echo.
pause
