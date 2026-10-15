# ============================================================================
# WoodTek ERP - Update Pack Builder (build-update.ps1)
# ----------------------------------------------------------------------------
# Builds a single "update pack" ZIP on THIS PC (the one that has the source
# code and Node.js). Copy that ZIP to any PC running WoodTek ERP
# (normally C:\WoodTek-ERP), double-click installer\apply-update.bat there,
# and the machine is updated in place.
#
# The update pack contains ONLY application files:
#   1. The production Next.js standalone build (.next\standalone + static)
#   2. The launcher and ops files (start-prod.cjs, start-woodtek-prod*.bat)
#   3. Database schema & bootstrapper (installer\schema.sql, bootstrap-db.cjs)
#   4. The update engine itself (installer\apply-update.ps1) so an older
#      install can still apply a newer pack
#   5. A update.json manifest (version, git commit, build date, file count)
#
# It NEVER contains, and the update NEVER touches, these on the target PC:
#     .env            (DATABASE_URL + AUTH_SECRET - the keys to everything)
#     data\           (installed edition, module config, JSON overlay)
#     backups\        (DB dumps and snapshots)
#     logs\
#     runtime\        (portable Node.js)
# so local configuration, licences and history survive every update.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File installer\build-update.ps1
#   (or double-click build-update.bat)
#
# Options:
#   -SkipBuild          reuse the existing .next\standalone instead of rebuilding
#   -OutputDir <path>   where to write the ZIP (default: dist-update)
#   -Version <string>   override the version stamp (default: yyyyMMdd-<gitsha>)
#   -Port <n>           app port to bring back up afterwards (default: 3000)
#
# Note: scripts\build-prod.cjs has to STOP the running server to rebuild the
# standalone folder. If the server was up when this script started, step 6
# starts it again - packing an update must never leave the factory sitting
# there with no running app.
# ============================================================================

param(
    [switch]$SkipBuild,
    [string]$OutputDir = "dist-update",
    [string]$Version = "",
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Write-Banner([string]$msg) {
    Write-Host "`n==================================================================" -ForegroundColor Cyan
    Write-Host "  $msg" -ForegroundColor Cyan
    Write-Host "==================================================================" -ForegroundColor Cyan
}
function Write-Info([string]$msg) {
    Write-Host "  -> $msg" -ForegroundColor Gray
}
function Write-Warn([string]$msg) {
    Write-Host "  [warn] $msg" -ForegroundColor DarkYellow
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

# The build number the RUNNING server reports (src\app\api\health\route.ts).
# Empty on versions built before that existed - never fatal.
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

Write-Banner "WoodTek ERP - Building Update Pack"

# ----------------------------------------------------------------------------
# 1. Work out the version stamp
# ----------------------------------------------------------------------------
Write-Host "[1/6] Determining version stamp..." -ForegroundColor Yellow

$gitSha = ""
try {
    $gitSha = (& git rev-parse --short HEAD 2>$null | Out-String).Trim()
} catch {
    $gitSha = ""
}
if (-not $gitSha -or $gitSha -match "\s") { $gitSha = "nogit" }

if ($Version) {
    $stamp = $Version
} else {
    $stamp = (Get-Date -Format "yyyyMMdd") + "-" + $gitSha
}
# Strip anything Windows refuses in a file name.
$safeStamp = ($stamp -replace '[\\/:*?"<>| ]', "-")
Write-Info "Version: $stamp"

# ----------------------------------------------------------------------------
# 2. Build the production standalone bundle (unless -SkipBuild)
# ----------------------------------------------------------------------------
Write-Host "[2/6] Building production bundle..." -ForegroundColor Yellow
$standaloneServer = Join-Path $Root ".next\standalone\server.js"

# scripts\build-prod.cjs STOPS the server to free the port, and does not start
# it again. Remember whether it was up, so we can bring it back at step 6 -
# otherwise packing an update leaves the factory PC with no running app.
$serverWasRunning = $false

if ($SkipBuild -and (Test-Path $standaloneServer)) {
    Write-Info "Using existing standalone build at .next\standalone (no rebuild)."
} else {
    if ($SkipBuild) { Write-Info "-SkipBuild was requested but no standalone build exists - building anyway." }
    $serverWasRunning = Test-TcpPort "127.0.0.1" $Port
    if ($serverWasRunning) {
        Write-Info "The WoodTek server is running on port $Port. The build has to stop it - it will be restarted when the pack is ready."
    }
    & node "scripts\build-prod.cjs"
    if ($LASTEXITCODE -ne 0) {
        # The build stops the running server to replace .next. If the build
        # then fails, bring the server back the same way step 6 does - packing
        # must never leave this PC without its running app (2026-10-14).
        if ($serverWasRunning) {
            Write-Info "Build failed - restarting the WoodTek server that the build stopped..."
            try { schtasks /Run /TN "\WoodTek ERP" 2>$null | Out-Null } catch {}
        }
        throw "Production build failed (exit code $LASTEXITCODE)."
    }
}

if (-not (Test-Path $standaloneServer)) {
    throw "Missing .next\standalone\server.js after build - cannot pack an update."
}

# ----------------------------------------------------------------------------
# 3. Stage the payload
# ----------------------------------------------------------------------------
Write-Host "[3/6] Staging update payload..." -ForegroundColor Yellow
$stageDir = Join-Path $env:TEMP ("woodtek-update-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

try {
    # 3a. The standalone application itself.
    $stageStandalone = Join-Path $stageDir ".next\standalone"
    New-Item -ItemType Directory -Path $stageStandalone -Force | Out-Null
    Copy-Item -Path (Join-Path $Root ".next\standalone\*") -Destination $stageStandalone -Recurse -Force

    $nextStatic = Join-Path $Root ".next\static"
    $stageNextStatic = Join-Path $stageStandalone ".next\static"
    if ((Test-Path $nextStatic) -and -not (Test-Path $stageNextStatic)) {
        New-Item -ItemType Directory -Path $stageNextStatic -Force | Out-Null
        Copy-Item -Path (Join-Path $nextStatic "*") -Destination $stageNextStatic -Recurse -Force
    }

    $publicDir = Join-Path $Root "public"
    $stagePublic = Join-Path $stageStandalone "public"
    if ((Test-Path $publicDir) -and -not (Test-Path $stagePublic)) {
        Copy-Item -Path $publicDir -Destination $stagePublic -Recurse -Force
    }

    # Guard (2026-10-14): the app cannot run - and the target PC's schema sync
    # cannot run - without these two inside the pack. Refuse to build a pack
    # that is missing them instead of shipping the failure to a server.
    if (-not (Test-Path (Join-Path $stageStandalone "server.js"))) {
        throw "The staged standalone build has no server.js - the pack would be broken. Delete .next, run npm install, then build again."
    }
    if (-not (Test-Path (Join-Path $stageStandalone "node_modules\pg\package.json"))) {
        throw "The staged standalone build has no node_modules\pg - the target PC's schema sync and app need it. Run npm install (or delete .next and build again), then re-run this file."
    }

    # 3b. Root launcher / ops files. check-server and copy-backups-offsite are
    #     the owner's double-click helpers on the server: they must arrive with
    #     every install and every update (see RUNBOOK.txt).
    foreach ($file in @(
        "start-prod.cjs",
        "start-woodtek-prod.bat",
        "start-woodtek-prod-silent.bat",
        "RUNBOOK.txt",
        ".env.example",
        "check-server.js",
        "check-server.bat",
        "copy-backups-offsite.ps1",
        "copy-backups-offsite.bat"
    )) {
        $src = Join-Path $Root $file
        if (Test-Path $src) {
            Copy-Item -Path $src -Destination (Join-Path $stageDir $file) -Force
        }
    }

    # 3c. Installer folder: schema, DB bootstrapper, edition configurator and
    #     the apply-update engine + its double-click launcher.
    $stageInstaller = Join-Path $stageDir "installer"
    New-Item -ItemType Directory -Path $stageInstaller -Force | Out-Null
    foreach ($inf in @(
        "schema.sql",
        "bootstrap-db.cjs",
        "install-engine.ps1",
        "configure-edition.ps1",
        "apply-update.ps1",
        "apply-update.bat",
        "restore-migration.ps1",
        "restore-migration.bat"
    )) {
        $iSrc = Join-Path $Root "installer\$inf"
        if (Test-Path $iSrc) {
            Copy-Item -Path $iSrc -Destination (Join-Path $stageInstaller $inf) -Force
        } else {
            if ($inf -eq "apply-update.ps1" -or $inf -eq "apply-update.bat") {
                Write-Host "  [warn] $inf not found - the target PC must already have it." -ForegroundColor DarkYellow
            }
        }
    }

    # 3d. Nightly backup scripts (the scheduled task needs them) plus the
    #     backup diagnosis helper the RUNBOOK points at.
    $stageBackup = Join-Path $stageDir "backup"
    New-Item -ItemType Directory -Path $stageBackup -Force | Out-Null
    foreach ($bf in @("backup-woodtek.ps1", "install-backup-task.bat", "prepare-migration.ps1", "prepare-migration.bat", "find-postgres-tools.ps1", "find-postgres-tools.bat")) {
        $bSrc = Join-Path $Root "backup\$bf"
        if (Test-Path $bSrc) {
            Copy-Item -Path $bSrc -Destination (Join-Path $stageBackup $bf) -Force
        }
    }

    # 3e. Windows line endings for batch files (2026-10-15). cmd.exe locates
    #     jump labels by counting bytes, so a .bat that arrives with Unix
    #     endings can abort with "... was unexpected at this time" before it
    #     prints a single line - exactly what check-server.bat did on the
    #     factory server while working perfectly on this PC. Force CRLF on
    #     every .bat/.cmd in the pack so the endings can never depend on how
    #     this PC happened to check the file out. (.gitattributes pins the
    #     repository side; this pins the pack side.)
    $crlfFixed = 0
    foreach ($bat in (Get-ChildItem -Path $stageDir -Recurse -File | Where-Object { $_.Extension -match '^\.(bat|cmd)$' })) {
        $batText = [System.IO.File]::ReadAllText($bat.FullName)
        $batFixed = ($batText -replace "`r`n", "`n") -replace "`n", "`r`n"
        if ($batFixed -ne $batText) {
            [System.IO.File]::WriteAllText($bat.FullName, $batFixed, (New-Object System.Text.UTF8Encoding($false)))
            $crlfFixed++
        }
    }
    if ($crlfFixed -gt 0) { Write-Info "Normalised Windows line endings in $crlfFixed batch file(s)." }

    # 3f. Manifest. apply-update.ps1 reads this to report what it is installing
    #     and to refuse a pack that is older than what is already installed.
    $fileCount = (Get-ChildItem -Path $stageDir -Recurse -File).Count
    $manifest = [ordered]@{
        package           = "WoodTek-ERP-Update"
        manifestVersion   = 1
        version           = $stamp
        gitSha            = $gitSha
        builtAtIso        = (Get-Date).ToString("yyyy-MM-ddTHH:mm:ssK")
        builtOn           = "$env:COMPUTERNAME"
        builtBy           = "$env:USERNAME"
        fileCount         = $fileCount
        # apply-update.ps1 must never overwrite these on the target PC.
        preserve          = @(".env", "data", "backups", "logs", "runtime")
        notes             = "Apply with installer\apply-update.bat on the target PC."
    }
    $manifestPath = Join-Path $stageDir "update.json"
    ($manifest | ConvertTo-Json -Depth 5) | Set-Content -Path $manifestPath -Encoding UTF8
    Write-Info "Staged $fileCount files."

    # ------------------------------------------------------------------------
    # 4. Compress into the update pack
    # ------------------------------------------------------------------------
    Write-Host "[4/6] Compressing update pack..." -ForegroundColor Yellow
    $outFolder = Join-Path $Root $OutputDir
    if (!(Test-Path $outFolder)) {
        New-Item -ItemType Directory -Path $outFolder -Force | Out-Null
    }

    $zipPath = Join-Path $outFolder ("WoodTek-ERP-Update-" + $safeStamp + ".zip")
    if (Test-Path $zipPath) { Remove-Item -Path $zipPath -Force }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $stageDir,
        $zipPath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    # ------------------------------------------------------------------------
    # 5. SHA-256 sidecar so the target PC can prove the pack arrived intact
    # ------------------------------------------------------------------------
    Write-Host "[5/6] Writing checksum..." -ForegroundColor Yellow
    $hash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash
    $shaPath = $zipPath + ".sha256"
    ("{0}  {1}" -f $hash, (Split-Path $zipPath -Leaf)) | Set-Content -Path $shaPath -Encoding ASCII

    $sizeMb = [math]::Round(((Get-Item $zipPath).Length / 1MB), 2)

    # ------------------------------------------------------------------------
    # 6. Leave the PC the way we found it: the build stopped the server, so
    #    start it again. Packing an update must never leave the factory
    #    without a running app.
    # ------------------------------------------------------------------------
    if ($serverWasRunning) {
        Write-Host "[6/6] Restarting the WoodTek server (the build stopped it)..." -ForegroundColor Yellow
        $restarted = $false
        try {
            schtasks /Run /TN "\WoodTek ERP" 2>$null | Out-Null
            if ($LASTEXITCODE -eq 0) { $restarted = $true }
        } catch {}

        $healthy = $false
        if ($restarted) {
            $waited = 0
            while ((-not $healthy) -and ($waited -lt 60)) {
                Start-Sleep -Seconds 2
                $waited += 2
                $healthy = Test-TcpPort "127.0.0.1" $Port
            }
        }

        if ($healthy) {
            $runningBuild = Get-HealthBuild
            if ($runningBuild) {
                Write-Info "WoodTek ERP is back up at http://localhost:$Port - running build: $runningBuild"
            } else {
                Write-Info "WoodTek ERP is back up at http://localhost:$Port"
            }
        } else {
            Write-Warn "Could not restart the server automatically (schtasks /Run needs administrator rights)."
            Write-Warn "Start it yourself:  schtasks /Run /TN '\WoodTek ERP'   - or double-click update-woodtek.bat"
        }
    }

    Write-Banner "SUCCESS: Update pack created"
    Write-Host "  Pack     : $zipPath" -ForegroundColor Green
    Write-Host "  Version  : $stamp" -ForegroundColor Green
    Write-Host "  Size     : $sizeMb MB" -ForegroundColor Green
    Write-Host "  SHA-256  : $hash" -ForegroundColor Green
    Write-Host "`n  What to do next:" -ForegroundColor White
    Write-Host "    1. Copy BOTH files to the target PC (keep them side by side):" -ForegroundColor White
    Write-Host "         $(Split-Path $zipPath -Leaf)" -ForegroundColor White
    Write-Host "         $(Split-Path $shaPath -Leaf)" -ForegroundColor White
    Write-Host "    2. On that PC, double-click  installer\apply-update.bat" -ForegroundColor White
    Write-Host "       (or  installer\apply-update.ps1 -UpdateZip <path to zip>)" -ForegroundColor White
    Write-Host "    3. Wait for 'WoodTek ERP is running and healthy'.`n" -ForegroundColor White
} finally {
    Remove-Item -Path $stageDir -Recurse -Force -ErrorAction SilentlyContinue
}
