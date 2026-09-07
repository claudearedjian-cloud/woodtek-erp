@echo off
cd /d C:\woodtek-erp
powershell.exe -ExecutionPolicy Bypass -File .\scripts\backup-windows.ps1
pause
