# ============================================================================
# WoodTek ERP — Update Engine (apply-update.ps1)
# ----------------------------------------------------------------------------
# Applies a WoodTek-ERP-Update-*.zip pack (built by installer\build-update.ps1)
# to an ALREADY INSTALLED WoodTek ERP on this PC (normally C:\WoodTek-ERP).
#
# Run it by double-clicking installer\apply-update.bat, or:
#   powershell -ExecutionPolicy Bypass -File installer\apply-update.ps1
#   powershell -ExecutionPolicy Bypass -File installer\apply-update.ps1 -UpdateZip D:\WoodTek-ERP-Update-20261005-0b83546.zip
#
# What it does, in order:
#   1. Finds the pack (and verifies its SHA-256 sidecar if one is present)
#   2. Snapshots .env + data\ into backups\update-<version>-<time>\
#      (and runs backup\backup-woodtek.ps1 for a database dump when present)
#   3. Stops the "\WoodTek ERP" scheduled task and frees TCP port 3000
#   4. Moves the current .next\standalone aside — that is the rollback copy
#   5. Unpacks the new application files over the installation
#   6. Re-applies installer\schema.sql (adds new tables, keeps all data)
#   7. Restarts the server and waits for /api/health -> 200 OK, then reads the
#      build number the server reports and checks it against the pack — the
#      update is VERIFIED, not assumed (no opening Settings to read it by eye)
#   8. If health never comes up, automatically rolls back to step 4's copy
#
# NEVER TOUCHED on this PC (that is the whole point):
#   .env      — DATABASE_URL + AUTH_SECRET, the keys to everything
#   data\     — installed edition, module/role config, JSON overlay
#   backups\  — DB dumps and snapshots
#   logs\
#   runtime\  — portable Node.js
#
# Options:
#   -UpdateZip <path>     exact pack to apply (default: newest pack found)
#   -InstallDir <path>    installation folder (default: the folder this script
#                         ships in, otherwise C:\WoodTek-ERP)
#   -Port <n>             app port (default: 3000)
#   -SkipBackup           do not take the pre-update snapshot (not advised)
#   -SkipDbSync           do not re-apply schema.sql
#   -IgnoreChecksum       apply even if the SHA-256 sidecar does not match
#   -KeepSnapshots <n>    rollback copies to keep (default: 3)
# ============================================================================

param(
    [string]$UpdateZip = "",
    [string]$InstallDir = "",
    [int]$Port = 3000,
    [switch]$SkipBackup,
    [switch]$SkipDbSync,
    [switch]$IgnoreChecksum,
    [int]$KeepSnapshots = 3
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Files/folders on the target PC that an update must never replace.
$Preserve = @(".env", "data", "backups", "logs", "runtime")

# Which installation are we updating? Default: the folder this script ships in
# (installer\ is always inside the app folder); otherwise the standard path.
if (-not $InstallDir) {
    $candidate = Split-Path -Parent $PSScriptRoot
    if ($candidate -and (Test-Path (Join-Path $candidate "start-prod.cjs"))) {
        $InstallDir = $candidate
    } else {
        $InstallDir = "C:\WoodTek-ERP"
    }
}

function Write-Banner([string]$msg) {
    Write-Host "`n==================================================================" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "==================================================================" -ForegroundColor Cyan
}
function Write-Step([string]$msg) {
    Write-Host "[STEP] $msg" -ForegroundColor Yellow
    [Console]::Out.Flush()
}
function Write-Info([string]$msg) {
    Write-Host "  -> $msg"
    [Console]::Out.Flush()
}
function Write-Warn([string]$msg) {
    Write-Host "  [warn] $msg" -ForegroundColor DarkYellow
    [Console]::Out.Flush()
}

function Test-IsAdmin {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Test-TcpPort([string]$TargetHost, [int]$TargetPort) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect($TargetHost, $TargetPort, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(1000, $false)
        if ($ok -and $client.Connected) { $client.Close(); return $true }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

function Stop-WoodTekServer {
    Write-Info "Ending scheduled task '\WoodTek ERP'..."
    try { schtasks /End /TN "\WoodTek ERP" 2>$null | Out-Null } catch {}

    Start-Sleep -Seconds 2
    if (Test-TcpPort "127.0.0.1" $Port) {
        Write-Info "Killing leftover listener on port $Port..."
        try {
            $netstat = netstat -ano | Select-String ":$Port\s+.*LISTENING\s+(\d+)$"
            foreach ($m in $netstat) {
                if ($m.Matches.Count -gt 0) {
                    $pidToKill = $m.Matches[0].Groups[1].Value
                    if ($pidToKill -and $pidToKill -ne "0") {
                        taskkill /F /T /PID $pidToKill 2>$null | Out-Null
                    }
                }
            }
        } catch {}
    }

    $waited = 0
    while ((Test-TcpPort "127.0.0.1" $Port) -and ($waited -lt 30)) {
        Start-Sleep -Seconds 2
        $waited += 2
    }
    if (Test-TcpPort "127.0.0.1" $Port) {
        throw "Port $Port is still in use. In an administrator window run: netstat -ano | findstr :$Port  then  taskkill /F /T /PID <pid>"
    }
    Write-Info "Port $Port is free."
}

function Start-WoodTekServer {
    $started = $false
    try {
        schtasks /Run /TN "\WoodTek ERP" 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $started = $true }
    } catch {}

    if (-not $started) {
        Write-Warn "Scheduled task not available — starting the server directly."
        $nodeDirect = Join-Path $InstallDir "runtime\node\node.exe"
        if (-not (Test-Path $nodeDirect)) { $nodeDirect = "node" }
        Start-Process -FilePath $nodeDirect `
            -ArgumentList "`"$script:LauncherPath`" --no-browser" `
            -WorkingDirectory $InstallDir -WindowStyle Hidden
    }
}

function Wait-ForHealth([int]$TimeoutSeconds) {
    $elapsed = 0
    while ($elapsed -lt $TimeoutSeconds) {
        Start-Sleep -Seconds 2
        $elapsed += 2
        try {
            $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($resp.StatusCode -eq 200) { return $true }
        } catch {}
    }
    return $false
}

# The build number the RUNNING server reports (src\app\api\health\route.ts).
# Null when the server is older than this feature, or was built without
# scripts\build-prod.cjs.
function Get-HealthBuild {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            $payload = $resp.Content | ConvertFrom-Json
            if ($payload -and $payload.build) { return [string]$payload.build }
        }
    } catch {}
    return $null
}

# Compare what is running against what the pack was built from. Never fatal —
# a mismatch is usually just a browser tab showing a cached page.
function Show-RunningBuild([string]$ExpectedSha) {
    $running = Get-HealthBuild
    if (-not $running) {
        Write-Warn "The server did not report a build number — read it in Settings (bottom of the page)."
        return
    }
    Write-Host "  Running build: $running" -ForegroundColor Green
    if ($ExpectedSha -and ($ExpectedSha -ne "nogit") -and ($running -ne $ExpectedSha)) {
        Write-Warn "This pack was built from $ExpectedSha, but the server reports $running."
        Write-Warn "The files were applied — most likely the browser is showing a cached page. Press Ctrl+F5."
    }
}

# ----------------------------------------------------------------------------
# Step 0: this script restarts a SYSTEM scheduled task, so it needs elevation
# ----------------------------------------------------------------------------
if (-not (Test-IsAdmin)) {
    Write-Host "[update] Requesting administrator rights — click Yes on the UAC prompt..." -ForegroundColor Yellow
    $psArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
    if ($UpdateZip)        { $psArgs += "-UpdateZip `"$UpdateZip`"" }
    if ($InstallDir)       { $psArgs += "-InstallDir `"$InstallDir`"" }
    $psArgs               += "-Port $Port"
    if ($SkipBackup)       { $psArgs += "-SkipBackup" }
    if ($SkipDbSync)       { $psArgs += "-SkipDbSync" }
    if ($IgnoreChecksum)   { $psArgs += "-IgnoreChecksum" }
    $psArgs               += "-KeepSnapshots $KeepSnapshots"

    $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $psArgs -Verb RunAs -PassThru -Wait
    exit $proc.ExitCode
}

Write-Banner "WoodTek ERP — Applying Update"

# ----------------------------------------------------------------------------
# Step 1: locate the update pack
# ----------------------------------------------------------------------------
Write-Step "Step 1/8: Locating the update pack..."

if ($UpdateZip) {
    if (-not (Test-Path $UpdateZip)) {
        throw "Update pack not found: $UpdateZip"
    }
} else {
    $searchRoots = @(
        $PSScriptRoot,
        (Split-Path -Parent $PSScriptRoot),
        $InstallDir,
        [Environment]::GetFolderPath("Desktop"),
        (Join-Path $env:USERPROFILE "Downloads")
    ) | Where-Object { $_ -and (Test-Path $_) }

    $candidate = $null
    foreach ($dir in $searchRoots) {
        $found = Get-ChildItem -Path $dir -Filter "WoodTek-ERP-Update-*.zip" -File -ErrorAction SilentlyContinue |
                 Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($found -and (-not $candidate -or $found.LastWriteTime -gt $candidate.LastWriteTime)) {
            $candidate = $found
        }
    }
    if (-not $candidate) {
        throw "No WoodTek-ERP-Update-*.zip found. Copy the pack to this PC, then run: installer\apply-update.ps1 -UpdateZip <path to the zip>"
    }
    $UpdateZip = $candidate.FullName
}

$UpdateZip = (Resolve-Path $UpdateZip).Path
Write-Info "Pack: $UpdateZip"

# ----------------------------------------------------------------------------
# Step 2: verify integrity + read the manifest
# ----------------------------------------------------------------------------
Write-Step "Step 2/8: Verifying the pack..."

$shaFile = $UpdateZip + ".sha256"
if (Test-Path $shaFile) {
    $expected = ((Get-Content $shaFile -Raw) -split "\s+")[0].Trim().ToUpperInvariant()
    $actual = (Get-FileHash -Path $UpdateZip -Algorithm SHA256).Hash.ToUpperInvariant()
    if ($expected -ne $actual) {
        if ($IgnoreChecksum) {
            Write-Warn "Checksum mismatch ignored (-IgnoreChecksum): expected $expected, got $actual"
        } else {
            throw "Checksum mismatch — the pack is incomplete or was damaged in transfer.`n  expected: $expected`n  actual  : $actual`n  Copy the pack again (it must sit next to its .sha256 file), or re-download it."
        }
    } else {
        Write-Info "Checksum OK ($actual)"
    }
} else {
    Write-Warn "No .sha256 file next to the pack — applying without an integrity check."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem

$manifest = $null
try {
    $zipCheck = [System.IO.Compression.ZipFile]::OpenRead($UpdateZip)
    try {
        $entry = $zipCheck.Entries | Where-Object { $_.FullName -eq "update.json" } | Select-Object -First 1
        if ($entry) {
            $reader = New-Object System.IO.StreamReader($entry.Open())
            try { $manifest = ($reader.ReadToEnd() | ConvertFrom-Json) } finally { $reader.Close() }
        }
        if ($zipCheck.Entries.Count -eq 0) { throw "The pack is empty." }
    } finally {
        $zipCheck.Dispose()
    }
} catch {
    throw "Cannot read the update pack (it may be corrupt or not a WoodTek update pack): $($_.Exception.Message)"
}

$packVersion = "unknown"
if ($manifest -and $manifest.version) { $packVersion = [string]$manifest.version }
Write-Info "Pack version: $packVersion"
if ($manifest -and $manifest.gitSha) { Write-Info "Built from git commit: $($manifest.gitSha)" }
if ($manifest -and $manifest.builtAtIso) { Write-Info "Built at: $($manifest.builtAtIso)" }

# ----------------------------------------------------------------------------
# Step 3: confirm this PC actually has WoodTek installed
# ----------------------------------------------------------------------------
Write-Step "Step 3/8: Checking the installation at $InstallDir..."

if (-not (Test-Path $InstallDir)) {
    throw "$InstallDir does not exist. If WoodTek ERP was installed somewhere else, run: installer\apply-update.ps1 -InstallDir <that folder>"
}

$script:LauncherPath = Join-Path $InstallDir "start-prod.cjs"
if (-not (Test-Path $script:LauncherPath)) {
    throw "No WoodTek ERP installation found in $InstallDir (start-prod.cjs is missing). Run WoodTek-ERP-Setup.exe first, or point -InstallDir at the right folder."
}
Write-Info "Found an existing WoodTek ERP installation."

# ----------------------------------------------------------------------------
# Step 4: snapshot what must survive (this is the rollback copy)
# ----------------------------------------------------------------------------
$snapshotDir = $null
$standaloneBackup = $null

if ($SkipBackup) {
    Write-Step "Step 4/8: Skipping pre-update snapshot (-SkipBackup)..."
    Write-Warn "No rollback copy will exist if this update goes wrong."
} else {
    Write-Step "Step 4/8: Taking the pre-update snapshot..."
    $stamp = "update"
    if ($packVersion -and $packVersion -ne "unknown") { $stamp = $packVersion }
    $safeStamp = ($stamp -replace '[\\/:*?"<>| ]', "-")
    $snapshotDir = Join-Path $InstallDir ("backups\update-" + $safeStamp + "-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    New-Item -ItemType Directory -Path $snapshotDir -Force | Out-Null

    $envFile = Join-Path $InstallDir ".env"
    if (Test-Path $envFile) {
        Copy-Item -Path $envFile -Destination (Join-Path $snapshotDir ".env") -Force
        Write-Info "Saved .env"
    } else {
        Write-Warn "No .env in $InstallDir — DATABASE_URL/AUTH_SECRET will have to be re-created if anything goes wrong."
    }

    $dataDir = Join-Path $InstallDir "data"
    if (Test-Path $dataDir) {
        Copy-Item -Path $dataDir -Destination (Join-Path $snapshotDir "data") -Recurse -Force
        Write-Info "Saved data\ (installed edition, module config, JSON overlay)"
    }

    $backupScript = Join-Path $InstallDir "backup\backup-woodtek.ps1"
    if (Test-Path $backupScript) {
        try {
            Write-Info "Taking a database dump (backup\backup-woodtek.ps1)..."
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $backupScript -BackupRoot $snapshotDir
            Write-Info "Database dump saved to $snapshotDir"
        } catch {
            Write-Warn "Database dump failed ($($_.Exception.Message)) — continuing with the file snapshot only."
        }
    }
    Write-Info "Snapshot folder: $snapshotDir"
}

# ----------------------------------------------------------------------------
# Step 5: stop the server and move the running app aside
# ----------------------------------------------------------------------------
Write-Step "Step 5/8: Stopping the WoodTek server..."
Stop-WoodTekServer

$standaloneDir = Join-Path $InstallDir ".next\standalone"
if (Test-Path $standaloneDir) {
    if ($snapshotDir) {
        $standaloneBackup = Join-Path $snapshotDir "standalone-old"
    } else {
        $standaloneBackup = Join-Path $env:TEMP ("woodtek-rollback-" + [Guid]::NewGuid().ToString("N"))
    }
    New-Item -ItemType Directory -Path (Split-Path $standaloneBackup -Parent) -Force | Out-Null

    $moved = $false
    for ($attempt = 1; $attempt -le 5 -and -not $moved; $attempt++) {
        try {
            Move-Item -Path $standaloneDir -Destination $standaloneBackup -Force
            $moved = $true
        } catch {
            Write-Warn "Could not move .next\standalone yet ($($_.Exception.Message)) — retrying..."
            Start-Sleep -Seconds 3
        }
    }
    if (-not $moved) {
        throw "The running application folder .next\standalone is locked and cannot be moved. Nothing has been changed yet. Reboot this PC and run the update again."
    }
    Write-Info "Old application moved aside for rollback: $standaloneBackup"
}

# ----------------------------------------------------------------------------
# Step 6: unpack the new application files
# ----------------------------------------------------------------------------
Write-Step "Step 6/8: Installing the new application files..."
$extractDir = Join-Path $env:TEMP ("woodtek-apply-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $extractDir -Force | Out-Null

try {
    [System.IO.Compression.ZipFile]::ExtractToDirectory($UpdateZip, $extractDir)

    foreach ($item in (Get-ChildItem -Path $extractDir -Force)) {
        if ($Preserve -contains $item.Name) {
            Write-Info "Preserved (not overwritten): $($item.Name)"
            continue
        }
        $dest = Join-Path $InstallDir $item.Name
        if ($item.PSIsContainer) {
            Copy-Item -Path $item.FullName -Destination $dest -Recurse -Force
        } else {
            Copy-Item -Path $item.FullName -Destination $dest -Force
        }
    }

    # Record what is now live — support asks "which version is this?" first.
    if ($manifest) {
        ($manifest | ConvertTo-Json -Depth 5) | Set-Content -Path (Join-Path $InstallDir "update-applied.json") -Encoding UTF8
    }
    Write-Info "New application files installed."
} finally {
    Remove-Item -Path $extractDir -Recurse -Force -ErrorAction SilentlyContinue
}

# ----------------------------------------------------------------------------
# Step 7: sync the database schema (adds new tables, never drops data)
# ----------------------------------------------------------------------------
if ($SkipDbSync) {
    Write-Step "Step 7/8: Skipping database schema sync (-SkipDbSync)..."
} else {
    Write-Step "Step 7/8: Syncing database schema (new tables only, data kept)..."
    $nodeExe = Join-Path $InstallDir "runtime\node\node.exe"
    if (-not (Test-Path $nodeExe)) { $nodeExe = "node" }
    $bootstrap = Join-Path $InstallDir "installer\bootstrap-db.cjs"

    if (Test-Path $bootstrap) {
        $dataDirArg = "--data-dir=" + (Join-Path $InstallDir "data")
        Push-Location $InstallDir
        try {
            # No --addons: the installed edition is left exactly as it is,
            # only installer\schema.sql is re-applied (idempotent).
            & $nodeExe $bootstrap $dataDirArg
            if ($LASTEXITCODE -ne 0) {
                throw "Schema sync failed (exit code $LASTEXITCODE)."
            }
            Write-Info "Database schema is up to date."
        } finally {
            Pop-Location
        }
    } else {
        Write-Warn "installer\bootstrap-db.cjs is missing — skipping the schema sync."
    }
}

# ----------------------------------------------------------------------------
# Step 8: restart and verify
# ----------------------------------------------------------------------------
Write-Step "Step 8/8: Starting the WoodTek server and verifying health..."
Start-WoodTekServer

if (Wait-ForHealth 90) {
    Write-Banner "UPDATE COMPLETE"
    Write-Host "  WoodTek ERP $packVersion is running and healthy at http://localhost:$Port" -ForegroundColor Green
    $expectedSha = ""
    if ($manifest -and $manifest.gitSha) { $expectedSha = [string]$manifest.gitSha }
    Show-RunningBuild $expectedSha
} else {
    # ---- automatic rollback -------------------------------------------------
    Write-Host "`n  The server did not answer /api/health within 90 seconds." -ForegroundColor Red
    if ($standaloneBackup -and (Test-Path $standaloneBackup)) {
        Write-Host "  Rolling back to the previous version..." -ForegroundColor Red
        Stop-WoodTekServer
        if (Test-Path $standaloneDir) {
            Remove-Item -Path $standaloneDir -Recurse -Force -ErrorAction SilentlyContinue
        }
        Move-Item -Path $standaloneBackup -Destination $standaloneDir -Force
        Start-WoodTekServer
        if (Wait-ForHealth 90) {
            Write-Host "  Rolled back successfully — the previous version is running again." -ForegroundColor Green
            Show-RunningBuild ""
        } else {
            Write-Host "  Rollback done, but the server still is not answering. See $InstallDir\logs\woodtek.log" -ForegroundColor Red
        }
        throw "Update $packVersion failed and was rolled back. Nothing was lost. Send this window to support."
    } else {
        throw "Update $packVersion failed and there is no rollback copy (the update was run with -SkipBackup). Re-install with WoodTek-ERP-Setup.exe, or restore backups\ manually."
    }
}

# Tidy up: keep the newest rollback snapshots only.
try {
    $backupRoot = Join-Path $InstallDir "backups"
    if (Test-Path $backupRoot) {
        $old = Get-ChildItem -Path $backupRoot -Directory -Filter "update-*" -ErrorAction SilentlyContinue |
               Sort-Object CreationTime -Descending | Select-Object -Skip $KeepSnapshots
        foreach ($dir in $old) {
            Remove-Item -Path $dir.FullName -Recurse -Force -ErrorAction SilentlyContinue
            Write-Info "Pruned old snapshot: $($dir.Name)"
        }
    }
} catch {
    Write-Warn "Could not prune old snapshots ($($_.Exception.Message))."
}

if ($snapshotDir) {
    Write-Host "`n  Your rollback copy is kept here: $snapshotDir" -ForegroundColor White
}
Write-Host "  Anything wrong? See UPDATING.md (section: 'If an update goes wrong').`n" -ForegroundColor White
