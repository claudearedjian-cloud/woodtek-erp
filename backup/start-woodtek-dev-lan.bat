@echo off
cd /d C:\woodtek-erp

echo [INFO] Stopping running Node processes and clearing build cache...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; if (Test-Path '.next') { Remove-Item -LiteralPath '.next' -Recurse -Force -ErrorAction SilentlyContinue }; if (Test-Path 'node_modules\.cache') { Remove-Item -LiteralPath 'node_modules\.cache' -Recurse -Force -ErrorAction SilentlyContinue }"

echo [INFO] Launching browser window...
start "" "http://0.0.0"

echo [INFO] Starting Woodtek ERP development server...
npx next dev -H 0.0.0.0 -p 3000

pause
