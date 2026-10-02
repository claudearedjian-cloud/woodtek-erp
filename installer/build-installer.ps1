# ============================================================================
# WoodTek ERP — Turnkey Windows .exe Installer Builder (build-installer.ps1)
# ----------------------------------------------------------------------------
# Builds dist-installer\WoodTek-ERP-Setup.exe on your Windows PC.
#
# What gets packed into WoodTek-ERP-Setup.exe:
#   1. The production Next.js standalone build (.next\standalone + static)
#   2. Portable Node.js runtime (runtime\node\node.exe copied from this PC)
#   3. Database schema & bootstrapper (installer\schema.sql + bootstrap-db.cjs)
#   4. Turnkey setup engine (installer\install-engine.ps1) + backup scripts
#   5. Optional offline PostgreSQL 16 setup (pass -BundlePostgres or place
#      postgresql-setup.exe in installer\prereqs\)
#   6. Native Windows GUI Setup Wizard with Module Pack checkboxes (Core +
#      Invoicing & Money, Purchasing, Asset CMMS, Workforce & HR)
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File installer\build-installer.ps1
#   (or double-click build-installer.bat)
# ============================================================================

param(
    [switch]$SkipBuild,
    [switch]$BundlePostgres,
    [string]$OutputDir = "dist-installer"
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

Write-Banner "WoodTek ERP — Building Turnkey Windows .exe Installer"

# ----------------------------------------------------------------------------
# 1. Build Next.js standalone production output (unless -SkipBuild)
# ----------------------------------------------------------------------------
$standaloneServer = Join-Path $Root ".next\standalone\server.js"
if (-not $SkipBuild -or -not (Test-Path $standaloneServer)) {
    Write-Host "[1/5] Building production standalone bundle..." -ForegroundColor Yellow
    & node "scripts\build-prod.cjs"
    if ($LASTEXITCODE -ne 0) {
        throw "Production build failed (exit code $LASTEXITCODE)."
    }
} else {
    Write-Host "[1/5] Using existing standalone build at .next\standalone..." -ForegroundColor Green
}

if (-not (Test-Path $standaloneServer)) {
    throw "Missing .next\standalone\server.js after build."
}

# ----------------------------------------------------------------------------
# 2. Stage clean application + runtime files
# ----------------------------------------------------------------------------
Write-Host "[2/5] Staging application, database schema & Node.js runtime..." -ForegroundColor Yellow
$stageDir = Join-Path $env:TEMP ("woodtek-stage-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

try {
    # Copy .next\standalone (and ensure static + public are inside it)
    $stageStandalone = Join-Path $stageDir ".next\standalone"
    New-Item -ItemType Directory -Path $stageStandalone -Force | Out-Null
    Copy-Item -Path (Join-Path $Root ".next\standalone\*") -Destination $stageStandalone -Recurse -Force

    $nextStatic = Join-Path $Root ".next\static"
    $stageNextStatic = Join-Path $stageStandalone ".next\static"
    if ((Test-Path $nextStatic) -and -not (Test-Path $stageNextStatic)) {
        New-Item -ItemType Directory -Path $stageNextStatic -Force | Out-Null
        Copy-Item -Path (Join-Path $nextStatic "*") -Destination $stageNextStatic -Recurse -Force
    }

    # Copy root launcher and ops files
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

    # Copy nightly backup scripts
    $stageBackup = Join-Path $stageDir "backup"
    New-Item -ItemType Directory -Path $stageBackup -Force | Out-Null
    foreach ($bf in @("backup-woodtek.ps1", "install-backup-task.bat")) {
        $bSrc = Join-Path $Root "backup\$bf"
        if (Test-Path $bSrc) {
            Copy-Item -Path $bSrc -Destination (Join-Path $stageBackup $bf) -Force
        }
    }

    # Copy installer engine, schema & DB bootstrapper
    $stageInstaller = Join-Path $stageDir "installer"
    New-Item -ItemType Directory -Path $stageInstaller -Force | Out-Null
    foreach ($inf in @("schema.sql", "bootstrap-db.cjs", "install-engine.ps1", "configure-edition.ps1")) {
        $iSrc = Join-Path $Root "installer\$inf"
        if (Test-Path $iSrc) {
            Copy-Item -Path $iSrc -Destination (Join-Path $stageInstaller $inf) -Force
        }
    }

    # Bundle portable Node.js binary from current machine so target PC works offline
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCmd -and (Test-Path $nodeCmd.Source)) {
        $stageNodeDir = Join-Path $stageDir "runtime\node"
        New-Item -ItemType Directory -Path $stageNodeDir -Force | Out-Null
        Copy-Item -Path $nodeCmd.Source -Destination (Join-Path $stageNodeDir "node.exe") -Force
        Write-Host "  -> Bundled Node.js runtime ($($nodeCmd.Source))" -ForegroundColor Gray
    }

    # Optional offline PostgreSQL installer bundling
    $prereqPg = Join-Path $Root "installer\prereqs\postgresql-setup.exe"
    if ($BundlePostgres -and -not (Test-Path $prereqPg)) {
        $prereqDir = Join-Path $Root "installer\prereqs"
        New-Item -ItemType Directory -Path $prereqDir -Force | Out-Null
        $pgUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.6-1-windows-x64.exe"
        Write-Host "  -> Downloading PostgreSQL 16 installer for offline bundling..." -ForegroundColor Gray
        Invoke-WebRequest -Uri $pgUrl -OutFile $prereqPg -UseBasicParsing
    }
    if (Test-Path $prereqPg) {
        $stagePrereq = Join-Path $stageDir "prereqs"
        New-Item -ItemType Directory -Path $stagePrereq -Force | Out-Null
        Copy-Item -Path $prereqPg -Destination (Join-Path $stagePrereq "postgresql-setup.exe") -Force
        Write-Host "  -> Bundled offline PostgreSQL installer (prereqs\postgresql-setup.exe)" -ForegroundColor Gray
    }

    # ------------------------------------------------------------------------
    # 3. Compress staged payload into a ZIP archive
    # ------------------------------------------------------------------------
    Write-Host "[3/5] Compressing installation payload..." -ForegroundColor Yellow
    $outFolder = Join-Path $Root $OutputDir
    if (!(Test-Path $outFolder)) {
        New-Item -ItemType Directory -Path $outFolder -Force | Out-Null
    }
    $tempPayloadZip = Join-Path $env:TEMP ("woodtek-payload-" + [Guid]::NewGuid().ToString("N") + ".zip")
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $stageDir,
        $tempPayloadZip,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    # ------------------------------------------------------------------------
    # 4. Compile SetupWizard.cs into WoodTek-ERP-Setup.exe using built-in csc.exe
    # ------------------------------------------------------------------------
    Write-Host "[4/5] Compiling Windows GUI Setup Wizard (WoodTek-ERP-Setup.exe)..." -ForegroundColor Yellow
    $cscCandidates = @(
        "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
        "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
    )
    $cscExe = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $cscExe) {
        throw "Could not find Windows .NET Framework csc.exe compiler."
    }

    $setupExePath = Join-Path $outFolder "WoodTek-ERP-Setup.exe"
    if (Test-Path $setupExePath) {
        Remove-Item -Path $setupExePath -Force
    }

    $csFile = Join-Path $Root "installer\SetupWizard.cs"
    $manifestFile = Join-Path $Root "installer\app.manifest"
    $cscArgs = @(
        "/nologo",
        "/target:winexe",
        "/optimize+",
        "/out:$setupExePath",
        "/win32manifest:$manifestFile",
        "/r:System.dll",
        "/r:System.Drawing.dll",
        "/r:System.Windows.Forms.dll",
        "/r:System.IO.Compression.dll",
        "/r:System.IO.Compression.FileSystem.dll",
        $csFile
    )
    & $cscExe @cscArgs
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $setupExePath)) {
        throw "Failed to compile SetupWizard.cs with csc.exe."
    }

    # ------------------------------------------------------------------------
    # 5. Append payload.zip + 16-byte SFX trailer ("WTSETUP1" + Int64 zip size)
    # ------------------------------------------------------------------------
    Write-Host "[5/5] Embedding payload into single-file WoodTek-ERP-Setup.exe..." -ForegroundColor Yellow
    $zipInfo = Get-Item $tempPayloadZip
    $zipLength = [int64]$zipInfo.Length

    $exeStream = [System.IO.File]::Open($setupExePath, [System.IO.FileMode]::Append, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $zipStream = [System.IO.File]::OpenRead($tempPayloadZip)
        try {
            $zipStream.CopyTo($exeStream)
        } finally {
            $zipStream.Close()
        }

        $magicBytes = [System.Text.Encoding]::ASCII.GetBytes("WTSETUP1")
        $lenBytes = [System.BitConverter]::GetBytes($zipLength)
        $exeStream.Write($magicBytes, 0, 8)
        $exeStream.Write($lenBytes, 0, 8)
    } finally {
        $exeStream.Close()
    }

    Remove-Item -Path $tempPayloadZip -Force -ErrorAction SilentlyContinue

    $finalSizeMb = [math]::Round(((Get-Item $setupExePath).Length / 1MB), 2)
    Write-Banner "SUCCESS: Single-File Installer Created!"
    Write-Host "  File : $setupExePath" -ForegroundColor Green
    Write-Host "  Size : $finalSizeMb MB" -ForegroundColor Green
    Write-Host "`n  Copy WoodTek-ERP-Setup.exe to any Windows 10/11 PC and double-click it" -ForegroundColor White
    Write-Host "  to choose which modules to install and set up the entire system.`n" -ForegroundColor White
} finally {
    Remove-Item -Path $stageDir -Recurse -Force -ErrorAction SilentlyContinue
}
