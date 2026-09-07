# WoodTek - diagnose and free port 3000 (v2)
# Shows the listener's parent chain (so the watchdog is visible), kills the
# node.exe/cmd.exe tree top-down with taskkill (errors NOT hidden), waits 4s,
# then tells you exactly which case you are in.
Write-Host '[WoodTek] Port 3000 diagnosis v2'
$conn = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if (-not $conn) {
    Write-Host 'Port 3000 is FREE right now. Start WoodTek once.'
    exit 0
}
$L = ($conn | Select-Object -First 1).OwningProcess
Write-Host ("Listener on port 3000: PID {0}" -f $L)

# Walk the parent chain (max 5 levels) so we can SEE supervisor / watchdog
$chain = @()
$cur = $L
for ($i = 0; $i -lt 5; $i++) {
    $w = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $cur }
    if (-not $w) { break }
    $chain += $w
    Write-Host ("  level {0}: {1} PID={2} (parent PID {3})" -f $i, $w.Name, $w.ProcessId, $w.ParentProcessId)
    if ($i -gt 0 -and $w.Name -ne 'node.exe' -and $w.Name -ne 'cmd.exe') { break }
    if ($w.ParentProcessId -eq 0) { break }
    $cur = $w.ParentProcessId
}

# Kill top-down, whole tree, but only node.exe / cmd.exe members (never explorer/services)
$targets = @($chain | Where-Object { $_.Name -eq 'node.exe' -or $_.Name -eq 'cmd.exe' })
[array]::Reverse($targets)
foreach ($t in $targets) {
    Write-Host ("Running: taskkill /F /T /PID {0}   ({1})" -f $t.ProcessId, $t.Name)
    taskkill /F /T /PID $t.ProcessId
}

Start-Sleep -Seconds 4

$left = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($left) {
    $newPid = ($left | Select-Object -First 1).OwningProcess
    if ($newPid -eq $L) {
        Write-Host ("SAME PID {0} still listening: the kill was REFUSED (permissions)." -f $newPid)
        Write-Host 'Right-click the .bat and choose "Run as administrator", then run this again.'
    } else {
        Write-Host ("NEW PID {0} now listening (old was {1}): a WATCHDOG respawned WoodTek." -f $newPid, $L)
        Write-Host 'Look at the chain printed above: the top cmd.exe/node.exe is the watchdog.'
        Write-Host 'Send this whole window text plus start-prod.cjs and the start-*.bat files.'
    }
} else {
    Write-Host 'Port 3000 is FREE now. Start WoodTek once.'
}
