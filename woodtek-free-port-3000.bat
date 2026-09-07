@echo off
title WoodTek - free port 3000
echo.
echo [WoodTek] Checking what is listening on port 3000 ...
powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; if (-not $c) { Write-Host 'Port 3000 is FREE - nothing to kill. Start WoodTek now.' } else { $c | ForEach-Object { $n = 'unknown'; $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if ($p) { $n = $p.ProcessName }; Write-Host ('Killing ' + $n + ' (PID ' + $_.OwningProcess + ') ...'); Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }; Start-Sleep -Seconds 1; $left = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; if ($left) { Write-Host 'STILL LISTENING after kill - something respawned it. Run this again and note the process name shown above.' } else { Write-Host 'Port 3000 is free now. Start WoodTek.' } }"
echo.
pause
