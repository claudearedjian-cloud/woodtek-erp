# ============================================================================
# WoodTek ERP - Workflow Lab installer (install-workflow-lab.ps1)
# ----------------------------------------------------------------------------
# Creates a SECOND, side-by-side WoodTek installation for workflow testing:
#
#   folder        C:\WoodTek-Workflow-Lab        (default installation untouched)
#   port          3001                          (default installation keeps 3000)
#   database      woodtek_workflow_lab          (default database never reused)
#   task          "\WoodTek Workflow Lab"       (not "\WoodTek ERP")
#   backup task   "WoodTek Workflow Lab Nightly Backup"
#   firewall rule "WoodTek Workflow Lab Server" (deleted/recreated for THIS
#                                                instance only)
#   shortcuts     "WoodTek Workflow Lab" ...
#   log           logs\woodtek-workflow-lab.log
#
# Every one of those names comes from installer\instance-registry.json, and the
# safety rules live in installer\workflow-lab\preflight.cjs, which is called
# BEFORE anything is created and again AFTER the install is written.
#
# The four optional modules Invoicing & Money, Purchasing & Suppliers, HR &
# Payroll and Design Department are hard-locked through the installed-edition
# file (data\installed-edition.json), i.e. the same mechanism the Windows
# setup uses - not a hidden menu entry.
#
# This script NEVER stops, rewrites, re-points or backs up the default
# installation, and it never connects to the default database.
#
# Usage (normally started by Create-WoodTek-Workflow-Lab.bat in the repo root):
#   powershell -ExecutionPolicy Bypass -File installer\install-workflow-lab.ps1
#   ... -TargetDir "D:\WoodTek-Workflow-Lab" -Port 3002 -AppFiles copy
#   ... -Action Refresh -TargetDir "C:\WoodTek-Workflow-Lab"
#   ... -Action Verify  -TargetDir "C:\WoodTek-Workflow-Lab"
# ============================================================================

param(
    [ValidateSet("Install", "Refresh", "Verify")]
    [string]$Action = "Install",
    [string]$TargetDir = "",
    [int]$Port = 0,
    [string]$DbUrl = "",
    [int]$PgPort = 5432,
    [string]$PgSuperPassword = "postgres",
    [ValidateSet("auto", "copy", "build", "payload")]
    [string]$AppFiles = "auto",
    [string]$SourceDir = "",
    [string]$PayloadZip = "",
    [string]$ManagerName = "Workflow Lab Manager",
    [string]$ManagerPin = "1234",
    [switch]$SkipHealthCheck
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step([string]$msg) {
    Write-Host ""
    Write-Host "[lab] == $msg" -ForegroundColor Cyan
    [Console]::Out.Flush()
}

function Write-Info([string]$msg) {
    Write-Host "  -> $msg"
    [Console]::Out.Flush()
}

function Write-Warn([string]$msg) {
    Write-Host "  !! $msg" -ForegroundColor Yellow
    [Console]::Out.Flush()
}

function Test-TcpPort([string]$TargetHost, [int]$TargetPort) {
    try {
        $client = New-Object System.Net.Sockets.TcpClient
        $iar = $client.BeginConnect($TargetHost, $TargetPort, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(1000, $false)
        if ($ok -and $client.Connected) {
            $client.Close()
            return $true
        }
        $client.Close()
        return $false
    } catch {
        return $false
    }
}

# Merge-copy a folder tree (never nest source-into-destination, the trap that
# broke the 2026-10-14 update pack: .next\.next, installer\installer).
function Copy-TreeContents([string]$Source, [string]$Destination) {
    if (-not (Test-Path $Destination)) {
        New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    }
    foreach ($child in (Get-ChildItem -Path $Source -Force)) {
        $target = Join-Path $Destination $child.Name
        if ($child.PSIsContainer) {
            if (Test-Path $target) {
                Copy-TreeContents $child.FullName $target
            } else {
                Copy-Item -Path $child.FullName -Destination $target -Recurse -Force
            }
        } else {
            Copy-Item -Path $child.FullName -Destination $target -Force
        }
    }
}

function Copy-FileIfExists([string]$From, [string]$To) {
    if ($From -and (Test-Path $From)) {
        $parent = Split-Path -Parent $To
        if ($parent -and -not (Test-Path $parent)) {
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
        }
        Copy-Item -Path $From -Destination $To -Force
        return $true
    }
    return $false
}

function New-RandomSecret {
    $rng = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $generator.GetBytes($rng)
    } finally {
        $generator.Dispose()
    }
    return [Convert]::ToBase64String($rng)
}

# ---------------------------------------------------------------------------
# 0. Locate the registry, the preflight and this script's own family
# ---------------------------------------------------------------------------
$ScriptDir = $PSScriptRoot
$ParentDir = Split-Path -Parent $ScriptDir

$RegistryPath = Join-Path $ScriptDir "instance-registry.json"
if (-not (Test-Path $RegistryPath)) { $RegistryPath = Join-Path $ParentDir "installer\instance-registry.json" }
$PreflightPath = Join-Path $ScriptDir "workflow-lab\preflight.cjs"
if (-not (Test-Path $PreflightPath)) { $PreflightPath = Join-Path $ParentDir "installer\workflow-lab\preflight.cjs" }
$TemplatesDir = Join-Path $ScriptDir "workflow-lab\templates"
if (-not (Test-Path $TemplatesDir)) { $TemplatesDir = Join-Path $ParentDir "installer\workflow-lab\templates" }

if (-not (Test-Path $RegistryPath)) {
    throw "Missing instance-registry.json. Run this script from the repository (installer\install-workflow-lab.ps1) or from the Workflow Lab folder."
}
if (-not (Test-Path $PreflightPath)) {
    throw "Missing workflow-lab\preflight.cjs next to this script - the lab installer refuses to run without its safety checks."
}

$Registry = Get-Content -Raw -Path $RegistryPath | ConvertFrom-Json
$LabProfile = $Registry.instances.'workflow-lab'
$DefaultProfile = $Registry.instances.default
if (-not $LabProfile -or -not $DefaultProfile) {
    throw "instance-registry.json is missing the 'default' or 'workflow-lab' instance."
}

if (-not $TargetDir) { $TargetDir = [string]$LabProfile.installDir }
$portGiven = ($Port -gt 0)
$dbUrlGiven = [bool]$DbUrl
if (-not $Port -or $Port -le 0) { $Port = [int]$LabProfile.port }
if (-not $SourceDir) { $SourceDir = [string]$DefaultProfile.installDir }

# Refresh works on an ALREADY installed lab: take its port and its connection
# string from its own .env instead of assuming the defaults, so a lab created on
# port 3002 (or with a different Postgres password) refreshes correctly.
if ($Action -eq "Refresh") {
    $existingEnvPath = Join-Path $TargetDir ".env"
    if (Test-Path $existingEnvPath) {
        foreach ($line in (Get-Content -Path $existingEnvPath)) {
            if ((-not $portGiven) -and ($line -match "^\s*PORT\s*=\s*(\d+)\s*$")) {
                $Port = [int]$Matches[1]
            }
            if ((-not $dbUrlGiven) -and ($line -match "^\s*DATABASE_URL\s*=\s*(.+)$")) {
                $DbUrl = $Matches[1].Trim().Trim('"').Trim("'")
            }
        }
    }
}

$labTask = [string]$LabProfile.serviceTask
$labBackupTask = [string]$LabProfile.backupTask
$labBackupTime = [string]$LabProfile.backupTime
$labFirewallRule = [string]$LabProfile.firewallRule
$labDesktopShortcut = [string]$LabProfile.desktopShortcut
$labStartMenuFolder = [string]$LabProfile.startMenuFolder
$labStartMenuOpen = [string]$LabProfile.startMenuOpenShortcut
$labStartMenuServer = [string]$LabProfile.startMenuServerShortcut
$labSilentLauncher = [string]$LabProfile.silentLauncher
$labInteractiveLauncher = [string]$LabProfile.interactiveLauncher
$labLogFile = [string]$LabProfile.logFile
$labMarkerFile = [string]$LabProfile.markerFile
$labDatabase = [string]$LabProfile.databaseName
$labAddons = @($LabProfile.addons)
$labLocks = @($LabProfile.lockedOptionalModules)
$labAddonsArg = if ($labAddons.Count -gt 0) { $labAddons -join "," } else { "none" }
$labLocksArg = if ($labLocks.Count -gt 0) { $labLocks -join "," } else { "none" }

Write-Host ""
Write-Host "==========================================================" -ForegroundColor DarkCyan
Write-Host "  WoodTek Workflow Lab - $Action" -ForegroundColor Cyan
Write-Host "  Lab folder : $TargetDir" -ForegroundColor Gray
Write-Host "  Lab port   : $Port" -ForegroundColor Gray
Write-Host "  Lab database: $labDatabase" -ForegroundColor Gray
Write-Host "  Factory installation: $($DefaultProfile.installDir) (untouched)" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor DarkCyan

# ---------------------------------------------------------------------------
# 1. Find a Node.js runtime (the preflight and the DB bootstrap both need it)
# ---------------------------------------------------------------------------
$nodeCandidates = @()
if (Test-Path (Join-Path $TargetDir "runtime\node\node.exe")) { $nodeCandidates += (Join-Path $TargetDir "runtime\node\node.exe") }
if (Test-Path (Join-Path $SourceDir "runtime\node\node.exe")) { $nodeCandidates += (Join-Path $SourceDir "runtime\node\node.exe") }
if (Test-Path "C:\Program Files\nodejs\node.exe") { $nodeCandidates += "C:\Program Files\nodejs\node.exe" }
$pathNode = Get-Command node -ErrorAction SilentlyContinue
if ($pathNode -and $pathNode.Source) { $nodeCandidates += $pathNode.Source }

$nodeExe = $null
foreach ($candidate in $nodeCandidates) {
    try {
        $version = & $candidate "--version" 2>$null
        if ($LASTEXITCODE -eq 0 -and ("$version" -match "^v\d+")) {
            $nodeExe = $candidate
            break
        }
    } catch {
    }
}
if (-not $nodeExe) {
    throw "No working Node.js was found. The Workflow Lab needs the same runtime the factory installation uses - install Node.js 22 LTS and run this again."
}
Write-Info "Node.js runtime: $nodeExe"

if (-not $DbUrl) {
    $escapedPwd = [Uri]::EscapeDataString($PgSuperPassword)
    $DbUrl = "postgresql://postgres:$escapedPwd@localhost:$PgPort/$labDatabase"
}

function Invoke-LabPreflight([string]$ActionName, [string]$ExtraArgs) {
    $arguments = @(
        "`"$PreflightPath`"",
        "--action", $ActionName,
        "--target", "`"$TargetDir`"",
        "--port", "$Port",
        "--db-url", "`"$DbUrl`"",
        "--registry", "`"$RegistryPath`""
    )
    if ($ExtraArgs) { $arguments += $ExtraArgs }
    Write-Info "Safety preflight ($ActionName)..."
    $output = & $nodeExe @arguments 2>&1
    $code = $LASTEXITCODE
    foreach ($line in $output) { Write-Host "     $line" -ForegroundColor Gray }
    if ($code -ne 0) {
        throw "Safety preflight refused the Workflow Lab $ActionName. Nothing was created, changed or deleted. Reasons are above."
    }
}

# ---------------------------------------------------------------------------
# 2. Verify-only mode
# ---------------------------------------------------------------------------
if ($Action -eq "Verify") {
    Invoke-LabPreflight "verify" ""
    Write-Host ""
    Write-Host "[lab] VERIFIED: the Workflow Lab in $TargetDir uses its own port, database, tasks and firewall rule." -ForegroundColor Green
    exit 0
}

# ---------------------------------------------------------------------------
# 3. Administrator rights (scheduled tasks + firewall rule)
# ---------------------------------------------------------------------------
$isAdmin = $false
try {
    $probe = & net session 2>&1
    if ($LASTEXITCODE -eq 0) { $isAdmin = $true }
} catch {
    $isAdmin = $false
}
if (-not $isAdmin) {
    throw "Administrator rights are required (scheduled tasks and the Windows Firewall rule). Close this window and double-click Create-WoodTek-Workflow-Lab.bat (or update-workflow-lab.bat inside the lab folder) so it can ask for them."
}
Write-Info "Running with administrator rights."

# ---------------------------------------------------------------------------
# 4. Choose where the application files come from
# ---------------------------------------------------------------------------
function Test-LabLockSupport([string]$appDir) {
    if (-not $appDir -or -not (Test-Path $appDir)) { return $false }
    $check = & $nodeExe -e "process.exit(require('$($PreflightPath.Replace('\','/'))').appSupportsLabLocks(process.argv[1]) ? 0 : 1)" "$appDir" 2>&1
    return ($LASTEXITCODE -eq 0)
}

function Test-RepoLockSupport {
    $sourceFile = Join-Path $ParentDir "src\lib\installedEdition.ts"
    if (-not (Test-Path $sourceFile)) { $sourceFile = Join-Path $ScriptDir "..\src\lib\installedEdition.ts" }
    if (-not (Test-Path $sourceFile)) { return $false }
    $text = Get-Content -Raw -Path $sourceFile
    return ($text -match "lockedOptionalModules")
}

$appMode = $AppFiles
if ($appMode -eq "auto") {
    if ($PayloadZip) {
        $appMode = "payload"
    } elseif (Test-Path (Join-Path $SourceDir ".next\standalone\server.js")) {
        if (Test-LabLockSupport $SourceDir) {
            $appMode = "copy"
        } elseif ((Test-Path (Join-Path $ParentDir "package.json")) -and (Test-RepoLockSupport)) {
            $appMode = "build"
        } else {
            $appMode = "copy"
        }
    } elseif ((Test-Path (Join-Path $ParentDir "package.json")) -and (Test-RepoLockSupport)) {
        $appMode = "build"
    } else {
        throw "No application files found. Pass -SourceDir (an installed WoodTek ERP folder) or -PayloadZip (a Workflow Lab payload), or run this from the repository checkout so it can build the lab."
    }
}

if ($appMode -eq "copy") {
    if (-not (Test-LabLockSupport $SourceDir)) {
        throw ("The application files in $SourceDir predate the Workflow Lab module lock, so Design could still be switched on there. " +
               "Run Create-WoodTek-Workflow-Lab.bat again after updating this PC, or pass -PayloadZip with a payload built from this branch.")
    }
}
if ($appMode -eq "build" -and -not (Test-RepoLockSupport)) {
    throw "This repository checkout does not contain the Workflow Lab module lock (src\lib\installedEdition.ts). Pull the branch that has it first."
}
Write-Info "Application files: $appMode"

# ---------------------------------------------------------------------------
# 5. Preflight BEFORE anything is created or copied
# ---------------------------------------------------------------------------
if ($Action -eq "Install" -and (Test-TcpPort "127.0.0.1" $Port)) {
    throw ("TCP port $Port is already in use on this PC (probably the factory installation or another program). " +
           "Nothing was changed. Pick a free port with -Port, for example 3002.")
}
if ($Action -eq "Refresh" -and (Test-TcpPort "127.0.0.1" $Port)) {
    Write-Info "The lab is running on port $Port - it will be stopped and restarted (the factory task is not touched)."
}
if (-not (Test-TcpPort "127.0.0.1" $PgPort)) {
    Write-Warn "PostgreSQL does not answer on port $PgPort - trying to start its service."
    $pgServices = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue
    foreach ($svc in $pgServices) {
        try { Start-Service -Name $svc.Name -ErrorAction SilentlyContinue } catch { }
    }
    Start-Sleep -Seconds 4
    if (-not (Test-TcpPort "127.0.0.1" $PgPort)) {
        throw "PostgreSQL is not reachable on port $PgPort. Start the PostgreSQL service and run this again. Nothing was changed."
    }
}

$preflightExtra = ""
if ($appMode -eq "copy" -and $Action -eq "Install") {
    $preflightExtra = "--source `"$SourceDir`""
}
Invoke-LabPreflight $Action.ToLower() $preflightExtra

# ---------------------------------------------------------------------------
# 6. Stop the lab only (Refresh), then lay down the application files
# ---------------------------------------------------------------------------
if ($Action -eq "Refresh") {
    Write-Step "Stopping the Workflow Lab task (the factory task is not touched)"
    try { schtasks /End /TN "$labTask" 2>$null | Out-Null } catch { }
    Start-Sleep -Seconds 2
    if (Test-TcpPort "127.0.0.1" $Port) {
        $netstat = netstat -ano | Select-String ":$Port\s+.*LISTENING\s+(\d+)$"
        foreach ($match in $netstat) {
            if ($match.Matches.Count -gt 0) {
                $pidToKill = $match.Matches[0].Groups[1].Value
                if ($pidToKill -and $pidToKill -ne "0") { taskkill /F /T /PID $pidToKill 2>$null | Out-Null }
            }
        }
        Start-Sleep -Seconds 2
    }
    $existingEnv = Join-Path $TargetDir ".env"
    if (-not (Test-Path $existingEnv)) {
        throw "Refresh needs the existing lab .env - $existingEnv is missing. Use -Action Install for a new installation."
    }
}

Write-Step "Preparing the Workflow Lab folder"
if (-not (Test-Path $TargetDir)) {
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
}
foreach ($sub in @("data", "logs", "backups", "backups\nightly")) {
    $folder = Join-Path $TargetDir $sub
    if (-not (Test-Path $folder)) { New-Item -ItemType Directory -Path $folder -Force | Out-Null }
}

Write-Step "Laying down the lab application files"
    switch ($appMode) {
        "payload" {
            if (-not (Test-Path $PayloadZip)) { throw "Payload zip not found: $PayloadZip" }
            $stage = Join-Path $env:TEMP ("woodtek-lab-extract-" + [Guid]::NewGuid().ToString("N"))
            New-Item -ItemType Directory -Path $stage -Force | Out-Null
            try {
                Add-Type -AssemblyName System.IO.Compression.FileSystem
                [System.IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path $PayloadZip).Path, $stage)
                Copy-TreeContents $stage $TargetDir
                Write-Info "Payload extracted into $TargetDir."
            } finally {
                Remove-Item -Path $stage -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        "copy" {
            $standalone = Join-Path $TargetDir ".next\standalone"
            if (Test-Path $standalone) { Remove-Item -Path $standalone -Recurse -Force -ErrorAction SilentlyContinue }
            foreach ($dir in @(".next\standalone", "runtime\node")) {
                $src = Join-Path $SourceDir $dir
                if (Test-Path $src) {
                    Copy-TreeContents $src (Join-Path $TargetDir $dir)
                    Write-Info "Copied $dir (read-only copy - the factory installation was not changed)."
                }
            }
            foreach ($file in @("start-prod.cjs", "check-server.js", ".env.example", "RUNBOOK.txt")) {
                if (Copy-FileIfExists (Join-Path $SourceDir $file) (Join-Path $TargetDir $file)) {
                    Write-Info "Copied $file"
                }
            }
        }
        "build" {
            Write-Step "Building the lab application from this repository (no server is stopped)"
            $buildSha = "unknown"
            try {
                $buildSha = (& git -C $ParentDir rev-parse --short HEAD 2>$null | Select-Object -First 1)
            } catch { }
            $oldDataUrl = $env:DATABASE_URL
            $oldBuildEnv = $env:NEXT_PUBLIC_WOODTEK_BUILD
            $env:DATABASE_URL = $DbUrl
            $env:NEXT_PUBLIC_WOODTEK_BUILD = "$buildSha"
            Push-Location $ParentDir
            try {
                & cmd.exe /c "npx next build"
                if ($LASTEXITCODE -ne 0) {
                    throw "The production build of the lab failed (exit code $LASTEXITCODE). Nothing was installed; the factory installation is untouched."
                }
            } finally {
                Pop-Location
                $env:DATABASE_URL = $oldDataUrl
                $env:NEXT_PUBLIC_WOODTEK_BUILD = $oldBuildEnv
            }
            $repoStandalone = Join-Path $ParentDir ".next\standalone"
            if (-not (Test-Path (Join-Path $repoStandalone "server.js"))) {
                throw "The build finished without .next\standalone\server.js - cannot create the lab."
            }
            $standalone = Join-Path $TargetDir ".next\standalone"
            if (Test-Path $standalone) { Remove-Item -Path $standalone -Recurse -Force -ErrorAction SilentlyContinue }
            Copy-TreeContents $repoStandalone $standalone
            $staticSrc = Join-Path $ParentDir ".next\static"
            if (Test-Path $staticSrc) { Copy-TreeContents $staticSrc (Join-Path $standalone ".next\static") }
            $publicSrc = Join-Path $ParentDir "public"
            if (Test-Path $publicSrc) { Copy-TreeContents $publicSrc (Join-Path $standalone "public") }
            Write-Info "Built lab application files from commit $buildSha."
            foreach ($file in @("start-prod.cjs", "check-server.js", ".env.example", "RUNBOOK.txt")) {
                if (Copy-FileIfExists (Join-Path $ParentDir $file) (Join-Path $TargetDir $file)) {
                    Write-Info "Copied $file"
                }
            }
            if (Test-Path (Join-Path $SourceDir "runtime\node\node.exe")) {
                Copy-TreeContents (Join-Path $SourceDir "runtime\node") (Join-Path $TargetDir "runtime\node")
                Write-Info "Copied the Node.js runtime from the factory installation (read-only)."
            }
        }
    }

if ($Action -eq "Refresh") {
    Write-Info "The lab .env, data, logs and backups were left exactly as they were."
}

# Schema + database bootstrapper (version-matched with the app where possible).
$bootstrapSource = $SourceDir
if ($appMode -eq "build" -or $appMode -eq "payload") { $bootstrapSource = $ParentDir }
foreach ($file in @("installer\schema.sql", "installer\bootstrap-db.cjs")) {
    $from = Join-Path $bootstrapSource $file
    if (-not (Test-Path $from)) { $from = Join-Path $ParentDir $file }
    if (Copy-FileIfExists $from (Join-Path $TargetDir $file)) {
        Write-Info "Copied $file"
    } else {
        throw "Missing $file - the lab database cannot be created without it."
    }
}
foreach ($file in @("backup\backup-woodtek.ps1", "backup\find-postgres-tools.ps1", "backup\find-postgres-tools.bat")) {
    $from = Join-Path $SourceDir $file
    if (-not (Test-Path $from)) { $from = Join-Path $ParentDir $file }
    Copy-FileIfExists $from (Join-Path $TargetDir $file) | Out-Null
}

# Lab-only support files: preflight, registry, installer, double-click helpers.
Write-Step "Installing the Workflow Lab helpers and its instance record"
$labFilesSource = Join-Path $ParentDir "installer\workflow-lab"
if (-not (Test-Path $labFilesSource)) { $labFilesSource = Join-Path $ScriptDir "workflow-lab" }
$labFilesTarget = Join-Path $TargetDir "installer\workflow-lab"
if ((Test-Path $labFilesSource) -and ((Resolve-Path $labFilesSource).Path -ne (Resolve-Path $TargetDir).Path)) {
    if ((Resolve-Path $labFilesSource).Path -ne $labFilesTarget) {
        Copy-TreeContents $labFilesSource $labFilesTarget
    }
}
Copy-FileIfExists $RegistryPath (Join-Path $TargetDir "installer\instance-registry.json") | Out-Null
$selfInstaller = Join-Path $ParentDir "installer\install-workflow-lab.ps1"
if (-not (Test-Path $selfInstaller)) { $selfInstaller = $MyInvocation.MyCommand.Path }
try {
    Copy-FileIfExists $selfInstaller (Join-Path $TargetDir "installer\install-workflow-lab.ps1") | Out-Null
} catch {
    Write-Warn "Could not copy install-workflow-lab.ps1 into the lab ($($_.Exception.Message)) - the lab still works, only a later refresh needs the repository copy."
}

if (Test-Path $TemplatesDir) {
    foreach ($helper in (Get-ChildItem -Path $TemplatesDir -File)) {
        Copy-Item -Path $helper.FullName -Destination (Join-Path $TargetDir $helper.Name) -Force
    }
    Write-Info "Copied the lab start/stop/check/update helpers."
} else {
    throw "Missing workflow-lab\templates - the lab would have no start/stop helpers."
}

# ---------------------------------------------------------------------------
# 7. Write THIS instance's .env (never inherit the factory one)
# ---------------------------------------------------------------------------
Write-Step "Writing the lab .env (own port, own database, own AUTH_SECRET)"
$envFile = Join-Path $TargetDir ".env"
if ($Action -eq "Install") {
    if (Test-Path $envFile) {
        throw "$envFile already exists. The lab never reuses an existing .env - delete it only if you are sure it is a lab file."
    }
    $dataDir = Join-Path $TargetDir "data"
    $envLines = @(
        "# WoodTek Workflow Lab - generated by install-workflow-lab.ps1",
        "# This instance is separate from the factory WoodTek ERP installation.",
        "DATABASE_URL=$DbUrl",
        "AUTH_SECRET=$(New-RandomSecret)",
        "AUTH_COOKIE_SECURE=false",
        "PORT=$Port",
        "HOSTNAME=0.0.0.0",
        "WOODTEK_DATA_DIR=$dataDir"
    )
    [System.IO.File]::WriteAllText($envFile, ($envLines -join "`r`n") + "`r`n", (New-Object System.Text.UTF8Encoding($false)))
    Write-Info "Created $envFile"
} else {
    $envText = Get-Content -Raw -Path $envFile
    if ($envText -notmatch [Regex]::Escape($labDatabase)) {
        throw "The lab .env does not mention $labDatabase - refusing to continue. Restore the lab .env or reinstall the lab."
    }
    Write-Info "Kept the existing lab .env (port $Port, database $labDatabase)."
}

# ---------------------------------------------------------------------------
# 8. Database schema + hard module lock (installed-edition.json)
# ---------------------------------------------------------------------------
Write-Step "Creating the lab database schema and the module lock"
$bootstrap = Join-Path $TargetDir "installer\bootstrap-db.cjs"
if (-not (Test-Path $bootstrap)) { throw "Missing $bootstrap" }
$bootstrapArgs = @(
    "`"$bootstrap`"",
    "--addons=$labAddonsArg",
    "--locked-modules=$labLocksArg",
    "--db-url=`"$DbUrl`"",
    "--data-dir=`"$(Join-Path $TargetDir 'data')`"",
    "--manager-name=`"$ManagerName`"",
    "--manager-pin=`"$ManagerPin`""
)
& $nodeExe @bootstrapArgs
if ($LASTEXITCODE -ne 0) {
    throw "The lab database bootstrap failed (exit code $LASTEXITCODE). The factory database was not touched; the lab database may be empty or absent."
}
Write-Info "Lab database ready: $labDatabase (add-ons: $labAddonsArg; locked modules: $labLocksArg)."

# Instance marker - this is what makes the folder recognisably a lab folder, and
# what Refresh/Verify use to prove they are looking at the right installation.
$marker = @{
    version = 1
    instanceId = "workflow-lab"
    label = [string]$LabProfile.label
    port = $Port
    databaseName = $labDatabase
    installDir = $TargetDir
    serviceTask = $labTask
    backupTask = $labBackupTask
    firewallRule = $labFirewallRule
    desktopShortcut = $labDesktopShortcut
    startMenuFolder = $labStartMenuFolder
    logFile = $labLogFile
    addons = @($labAddons)
    lockedOptionalModules = @($labLocks)
    appFiles = $appMode
    installedAt = (Get-Date).ToUniversalTime().ToString("s") + "Z"
    note = "Side-by-side WoodTek Workflow Lab. The factory installation is separate."
}
$markerPath = Join-Path $TargetDir $labMarkerFile
[System.IO.File]::WriteAllText($markerPath, ($marker | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding($false)))
Write-Info "Wrote $markerPath"

# ---------------------------------------------------------------------------
# 9. Windows Firewall - THIS instance's rule only
# ---------------------------------------------------------------------------
Write-Step "Registering the lab firewall rule (factory rule untouched)"
try {
    netsh advfirewall firewall delete rule name="$labFirewallRule" 2>$null | Out-Null
    netsh advfirewall firewall add rule name="$labFirewallRule" dir=in action=allow protocol=TCP localport=$Port | Out-Null
    Write-Info "Firewall rule '$labFirewallRule' allows TCP $Port (and nothing else)."
} catch {
    Write-Warn "Could not write the firewall rule '$labFirewallRule' ($($_.Exception.Message))."
}

# ---------------------------------------------------------------------------
# 10. Scheduled tasks - THIS instance's tasks only
# ---------------------------------------------------------------------------
Write-Step "Registering the lab scheduled tasks"
$silentBat = Join-Path $TargetDir $labSilentLauncher
if (-not (Test-Path $silentBat)) { throw "Missing lab launcher $silentBat" }
schtasks /Create /F /TN "$labTask" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "`"$silentBat`"" | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Could not create the scheduled task '$labTask'."
}
Write-Info "Task '$labTask' starts the lab at boot (factory task '$($DefaultProfile.serviceTask)' untouched)."

$backupPs1 = Join-Path $TargetDir "backup\backup-woodtek.ps1"
if (Test-Path $backupPs1) {
    $backupCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$backupPs1`""
    schtasks /Create /F /TN "$labBackupTask" /SC DAILY /ST $labBackupTime /RU SYSTEM /RL HIGHEST /TR $backupCmd | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Info "Task '$labBackupTask' dumps the LAB database daily at $labBackupTime."
    } else {
        Write-Warn "Could not create '$labBackupTask'. The lab still runs; only its nightly dump is missing."
    }
}

# ---------------------------------------------------------------------------
# 11. Shortcuts - THIS instance's names only
# ---------------------------------------------------------------------------
Write-Step "Creating the lab shortcuts"
try {
    $wsh = New-Object -ComObject WScript.Shell
    $shortcutDir = [Environment]::GetFolderPath("CommonDesktopDirectory")
    if (-not $shortcutDir -or -not (Test-Path $shortcutDir)) {
        $shortcutDir = [Environment]::GetFolderPath("Desktop")
    }
    $desktopLink = Join-Path $shortcutDir $labDesktopShortcut
    $desktop = $wsh.CreateShortcut($desktopLink)
    $desktop.TargetPath = "http://localhost:$Port"
    $desktop.Description = "Open the WoodTek Workflow Lab (test installation, port $Port)"
    $desktop.Save()

    $startMenuDir = Join-Path ([Environment]::GetFolderPath("CommonPrograms")) $labStartMenuFolder
    if (-not (Test-Path $startMenuDir)) { New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null }
    $openLink = $wsh.CreateShortcut((Join-Path $startMenuDir $labStartMenuOpen))
    $openLink.TargetPath = "http://localhost:$Port"
    $openLink.Description = "Open the WoodTek Workflow Lab in the browser"
    $openLink.Save()

    $serverLink = $wsh.CreateShortcut((Join-Path $startMenuDir $labStartMenuServer))
    $serverLink.TargetPath = (Join-Path $TargetDir $labInteractiveLauncher)
    $serverLink.WorkingDirectory = $TargetDir
    $serverLink.Description = "Start the WoodTek Workflow Lab server"
    $serverLink.Save()

    $stopLink = $wsh.CreateShortcut((Join-Path $startMenuDir "Stop WoodTek Workflow Lab.lnk"))
    $stopLink.TargetPath = (Join-Path $TargetDir "stop-workflow-lab.bat")
    $stopLink.WorkingDirectory = $TargetDir
    $stopLink.Description = "Stop the WoodTek Workflow Lab server"
    $stopLink.Save()

    $updateLink = $wsh.CreateShortcut((Join-Path $startMenuDir "Update WoodTek Workflow Lab.lnk"))
    $updateLink.TargetPath = (Join-Path $TargetDir "update-workflow-lab.bat")
    $updateLink.WorkingDirectory = $TargetDir
    $updateLink.Description = "Refresh the WoodTek Workflow Lab application files"
    $updateLink.Save()

    Write-Info "Desktop shortcut '$labDesktopShortcut' and Start Menu folder '$labStartMenuFolder' created."
} catch {
    Write-Warn "Shortcut creation failed ($($_.Exception.Message)). The lab works without them."
}

# ---------------------------------------------------------------------------
# 12. Start ONLY the lab and wait for its health endpoint
# ---------------------------------------------------------------------------
Write-Step "Starting the Workflow Lab (factory task is not touched)"
schtasks /Run /TN "$labTask" | Out-Null

if (-not $SkipHealthCheck) {
    $healthy = $false
    $elapsed = 0
    while ((-not $healthy) -and ($elapsed -lt 90)) {
        Start-Sleep -Seconds 3
        $elapsed += 3
        try {
            $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($response.StatusCode -eq 200) { $healthy = $true }
        } catch {
        }
    }
    if ($healthy) {
        Write-Info "The Workflow Lab answers on http://localhost:$Port"
    } else {
        Write-Warn "The lab did not answer on port $Port within 90 seconds. Check $TargetDir\logs\$labLogFile - the factory installation is not affected."
    }
}

# ---------------------------------------------------------------------------
# 13. Post-install proof: the lab is its own instance
# ---------------------------------------------------------------------------
Invoke-LabPreflight "verify" ""

Write-Host ""
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  WoodTek Workflow Lab is ready" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "  Open          : http://localhost:$Port"
Write-Host "  Folder        : $TargetDir"
Write-Host "  Database      : $labDatabase (factory database untouched)"
Write-Host "  Scheduled task: $labTask"
Write-Host "  Backup task   : $labBackupTask at $labBackupTime"
Write-Host "  Firewall rule : $labFirewallRule (TCP $Port)"
Write-Host "  Locked modules: $labLocksArg"
Write-Host "  Factory install: $($DefaultProfile.installDir) on port $($DefaultProfile.port) - unchanged"
Write-Host ""
Write-Host "  Helpers in the lab folder: start-workflow-lab.bat, stop-workflow-lab.bat," -ForegroundColor Gray
Write-Host "  check-workflow-lab.bat, update-workflow-lab.bat" -ForegroundColor Gray
Write-Host ""
exit 0
