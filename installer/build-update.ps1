# ============================================================================
# WoodTek ERP — Update Pack Builder (build-update.ps1)
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
#     .env            (DATABASE_URL + AUTH_SECRET — the keys to everything)
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
# ============================================================================

param(
    [switch]$SkipBuild,
    [string]$OutputDir = "dist-update",
    [string]$Version = ""
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

Write-Banner "WoodTek ERP — Building Update Pack"

# ----------------------------------------------------------------------------
# 1. Work out the version stamp
# ----------------------------------------------------------------------------
Write-Host "[1/5] Determining version stamp..." -ForegroundColor Yellow

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
Write-Host "[2/5] Building production bundle..." -ForegroundColor Yellow
$standaloneServer = Join-Path $Root ".next\standalone\server.js"

if ($SkipBuild -and (Test-Path $standaloneServer)) {
    Write-Info "Using existing standalone build at .next\standalone (no rebuild)."
} else {
    if ($SkipBuild) { Write-Info "-SkipBuild was requested but no standalone build exists — building anyway." }
    & node "scripts\build-prod.cjs"
    if ($LASTEXITCODE -ne 0) {
        throw "Production build failed (exit code $LASTEXITCODE)."
    }
}

if (-not (Test-Path $standaloneServer)) {
    throw "Missing .next\standalone\server.js after build — cannot pack an update."
}

# ----------------------------------------------------------------------------
# 3. Stage the payload
# ----------------------------------------------------------------------------
Write-Host "[3/5] Staging update payload..." -ForegroundColor Yellow
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

    # 3b. Root launcher / ops files.
    foreach ($file in @(
        "start-prod.cjs",
        "start-woodtek-prod.bat",
        "start-woodtek-prod-silent.bat",
        "RUNBOOK.txt",
        ".env.example"
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
        "apply-update.bat"
    )) {
        $iSrc = Join-Path $Root "installer\$inf"
        if (Test-Path $iSrc) {
            Copy-Item -Path $iSrc -Destination (Join-Path $stageInstaller $inf) -Force
        } else {
            if ($inf -eq "apply-update.ps1" -or $inf -eq "apply-update.bat") {
                Write-Host "  [warn] $inf not found — the target PC must already have it." -ForegroundColor DarkYellow
            }
        }
    }

    # 3d. Nightly backup scripts (the scheduled task needs them).
    $stageBackup = Join-Path $stageDir "backup"
    New-Item -ItemType Directory -Path $stageBackup -Force | Out-Null
    foreach ($bf in @("backup-woodtek.ps1", "install-backup-task.bat")) {
        $bSrc = Join-Path $Root "backup\$bf"
        if (Test-Path $bSrc) {
            Copy-Item -Path $bSrc -Destination (Join-Path $stageBackup $bf) -Force
        }
    }

    # 3e. Manifest. apply-update.ps1 reads this to report what it is installing
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
    Write-Host "[4/5] Compressing update pack..." -ForegroundColor Yellow
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
    Write-Host "[5/5] Writing checksum..." -ForegroundColor Yellow
    $hash = (Get-FileHash -Path $zipPath -Algorithm SHA256).Hash
    $shaPath = $zipPath + ".sha256"
    ("{0}  {1}" -f $hash, (Split-Path $zipPath -Leaf)) | Set-Content -Path $shaPath -Encoding ASCII

    $sizeMb = [math]::Round(((Get-Item $zipPath).Length / 1MB), 2)

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
