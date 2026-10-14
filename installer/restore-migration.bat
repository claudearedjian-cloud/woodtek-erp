@echo off
title WoodTek ERP - put the factory data on this new server
cd /d %~dp0
echo.
echo  This replaces the fresh, empty database on THIS PC with the factory
echo  data from the WoodTek-Migration folder (made on the old server).
echo  The old server is not changed.
echo.
echo  If the migration folder is not on the Desktop, pass its path:
echo    restore-migration.bat  -PackDir "D:\WoodTek-Migration"
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0restore-migration.ps1" %*
echo.
pause
