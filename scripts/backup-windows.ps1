[CmdletBinding()]
param(
    [string]$ProjectRoot = "C:\woodtek-erp",
    [string]$BackupRoot = "C:\WoodTekBackups",
    [string]$PostgresBin = "",
    [ValidateRange(1, 3650)]
    [int]$RetentionDays = 30,
    [switch]$SkipOuterZip
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

function Write-Step {
    param(
        [int]$Number,
        [int]$Total,
        [string]$Message
    )

    Write-Host "[$Number/$Total] $Message" -ForegroundColor Yellow
}

function Get-PgBinCandidates {
    # Extra places the PostgreSQL tools can live: WOODTEK_PG_BIN, the registry
    # entry the installer writes, the folder the running service actually uses,
    # and the usual install folders on C:/D:/E: (every version subfolder).
    # Added 2026-10-14 after the nightly/migration backup died with
    # "pg_dump not found" on a PC whose PostgreSQL is not in Program Files.
    $Candidates = @()

    $Override = $env:WOODTEK_PG_BIN
    if (-not $Override) {
        $EnvFile = Join-Path (Split-Path -Parent $PSScriptRoot) ".env"
        if (Test-Path $EnvFile) {
            $Match = Select-String -Path $EnvFile -Pattern '^\s*WOODTEK_PG_BIN\s*=\s*(.+?)\s*$' | Select-Object -First 1
            if ($Match) { $Override = $Match.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'") }
        }
    }
    if ($Override) { $Candidates += $Override }

    foreach ($Root in @("HKLM:\SOFTWARE\PostgreSQL\Installations", "HKLM:\SOFTWARE\WOW6432Node\PostgreSQL\Installations")) {
        if (Test-Path $Root) {
            Get-ChildItem $Root -ErrorAction SilentlyContinue | ForEach-Object {
                $Base = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue)."Base Directory"
                if ($Base) { $Candidates += (Join-Path $Base "bin") }
            }
        }
    }

    try {
        $Services = Get-WmiObject Win32_Service -Filter "Name LIKE 'postgresql%'" -ErrorAction SilentlyContinue
        foreach ($Service in $Services) {
            $ExePath = "$($Service.PathName)".Trim()
            if (-not $ExePath) { continue }
            if ($ExePath.StartsWith('"')) {
                $End = $ExePath.IndexOf('"', 1)
                if ($End -gt 1) { $ExePath = $ExePath.Substring(1, $End - 1) }
            } else {
                $ExePath = ($ExePath -split '\s+')[0]
            }
            $ServiceDir = Split-Path -Parent $ExePath
            if ($ServiceDir) { $Candidates += $ServiceDir }
        }
    } catch { }

    $Roots = @()
    if ($env:ProgramFiles) { $Roots += (Join-Path $env:ProgramFiles "PostgreSQL") }
    if (${env:ProgramFiles(x86)}) { $Roots += (Join-Path ${env:ProgramFiles(x86)} "PostgreSQL") }
    foreach ($Drive in @("C:", "D:", "E:")) {
        $Roots += "$Drive\PostgreSQL"
        $Roots += "$Drive\pgsql"
    }
    foreach ($Root in $Roots) {
        if ($Root -and (Test-Path $Root)) {
            $Candidates += $Root
            Get-ChildItem $Root -Directory -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending |
                ForEach-Object { $Candidates += (Join-Path $_.FullName "bin") }
        }
    }

    return ($Candidates | Where-Object { $_ } | Select-Object -Unique)
}

function Find-PostgresTool {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ToolName,

        [string]$PreferredBin
    )

    if ($PreferredBin) {
        $PreferredPath = Join-Path $PreferredBin "$ToolName.exe"

        if (Test-Path $PreferredPath) {
            return $PreferredPath
        }
    }

    $Command = Get-Command "$ToolName.exe" -ErrorAction SilentlyContinue

    if ($Command) {
        return $Command.Source
    }

    foreach ($Directory in (Get-PgBinCandidates)) {
        $Candidate = Join-Path `
            $Directory `
            "$ToolName.exe"

        if (Test-Path $Candidate) {
            return $Candidate
        }
    }

    $PossibleVersions = @(
        "18",
        "17",
        "16",
        "15",
        "14"
    )

    foreach ($Version in $PossibleVersions) {
        $Candidate = Join-Path `
            "C:\Program Files\PostgreSQL\$Version\bin" `
            "$ToolName.exe"

        if (Test-Path $Candidate) {
            return $Candidate
        }
    }

    throw @"
$ToolName.exe was not found.

Install the PostgreSQL command-line tools, pass:

-PostgresBin "C:\Program Files\PostgreSQL\18\bin"

or set WOODTEK_PG_BIN in .env to the folder holding the tools
(backup\find-postgres-tools.bat finds that folder for you).
"@
}

function Get-DatabaseUrl {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EnvironmentFile
    )

    if (-not (Test-Path $EnvironmentFile)) {
        throw ".env was not found: $EnvironmentFile"
    }

    $Line = Get-Content $EnvironmentFile |
        Where-Object {
            $_ -match "^\s*DATABASE_URL\s*="
        } |
        Select-Object -First 1

    if (-not $Line) {
        throw "DATABASE_URL is missing from $EnvironmentFile"
    }

    $Value = (
        $Line -split "=", 2
    )[1].Trim()

    if (
        ($Value.StartsWith('"') -and $Value.EndsWith('"')) -or
        ($Value.StartsWith("'") -and $Value.EndsWith("'"))
    ) {
        $Value = $Value.Substring(
            1,
            $Value.Length - 2
        )
    }

    if (-not $Value) {
        throw "DATABASE_URL is empty."
    }

    return $Value
}

function Assert-LastExitCode {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Operation
    )

    if ($LASTEXITCODE -ne 0) {
        throw "$Operation failed with exit code $LASTEXITCODE."
    }
}

function Remove-OldBackups {
    param(
        [string]$Root,
        [int]$Days
    )

    $Cutoff = (Get-Date).AddDays(-$Days)

    Get-ChildItem `
        -Path $Root `
        -Directory `
        -Filter "WoodTek_*" `
        -ErrorAction SilentlyContinue |
        Where-Object {
            $_.LastWriteTime -lt $Cutoff
        } |
        Remove-Item `
            -Recurse `
            -Force `
            -ErrorAction SilentlyContinue

    Get-ChildItem `
        -Path $Root `
        -File `
        -Filter "WoodTek_*.zip" `
        -ErrorAction SilentlyContinue |
        Where-Object {
            $_.LastWriteTime -lt $Cutoff
        } |
        Remove-Item `
            -Force `
            -ErrorAction SilentlyContinue
}

$Timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$PackageName = "WoodTek_$Timestamp"

$ProjectRoot = (
    Resolve-Path $ProjectRoot
).Path

$EnvironmentFile = Join-Path $ProjectRoot ".env"

$PackageDirectory = Join-Path `
    $BackupRoot `
    $PackageName

$OuterZip = Join-Path `
    $BackupRoot `
    "$PackageName.zip"

$StageDirectory = Join-Path `
    $env:TEMP `
    "$PackageName-source"

$DatabaseBackup = Join-Path `
    $PackageDirectory `
    "woodtek_database.backup"

$SourceArchive = Join-Path `
    $PackageDirectory `
    "woodtek_source.zip"

$SecretEnvironmentBackup = Join-Path `
    $PackageDirectory `
    "woodtek.env.SECRET"

$InfoFile = Join-Path `
    $PackageDirectory `
    "BACKUP_INFO.txt"

$ChecksumFile = Join-Path `
    $PackageDirectory `
    "SHA256SUMS.txt"

$DatabaseUrl = Get-DatabaseUrl `
    -EnvironmentFile $EnvironmentFile

$PgDump = Find-PostgresTool `
    -ToolName "pg_dump" `
    -PreferredBin $PostgresBin

Write-Host ""
Write-Host "WoodTek ERP Backup" -ForegroundColor Cyan
Write-Host "==================" -ForegroundColor Cyan
Write-Host "Project : $ProjectRoot"
Write-Host "Output  : $PackageDirectory"
Write-Host "pg_dump: $PgDump"
Write-Host ""

New-Item `
    -ItemType Directory `
    -Path $BackupRoot `
    -Force |
    Out-Null

New-Item `
    -ItemType Directory `
    -Path $PackageDirectory `
    -Force |
    Out-Null

New-Item `
    -ItemType Directory `
    -Path $StageDirectory `
    -Force |
    Out-Null

try {
    Write-Step `
        -Number 1 `
        -Total 7 `
        -Message "Validating database connection"

    & $PgDump `
        --dbname=$DatabaseUrl `
        --schema-only `
        --no-owner `
        --no-privileges `
        --file="$(Join-Path $StageDirectory 'connection-test.sql')"

    Assert-LastExitCode `
        -Operation "Database connection test"

    Remove-Item `
        (Join-Path $StageDirectory "connection-test.sql") `
        -Force

    Write-Step `
        -Number 2 `
        -Total 7 `
        -Message "Creating PostgreSQL custom-format backup"

    & $PgDump `
        --dbname=$DatabaseUrl `
        --format=custom `
        --compress=9 `
        --no-owner `
        --no-privileges `
        --file="$DatabaseBackup"

    Assert-LastExitCode `
        -Operation "PostgreSQL backup"

    if (-not (Test-Path $DatabaseBackup)) {
        throw "Database backup was not created."
    }

    if ((Get-Item $DatabaseBackup).Length -eq 0) {
        throw "Database backup is empty."
    }

    Write-Step `
        -Number 3 `
        -Total 7 `
        -Message "Staging source files"

    $RobocopyArguments = @(
        $ProjectRoot
        $StageDirectory
        "/E"
        "/COPY:DAT"
        "/DCOPY:T"
        "/R:1"
        "/W:1"
        "/NFL"
        "/NDL"
        "/NJH"
        "/NJS"
        "/NP"
        "/XD"
        ".next"
        "node_modules"
        ".git"
        "logs"
        "backups"
        ".vscode"
        "/XF"
        ".env"
        "*.log"
        "*.tmp"
        "*.cache"
        "*.tsbuildinfo"
    )

    & robocopy @RobocopyArguments |
        Out-Null

    # Robocopy 0-7 means success/information.
    if ($LASTEXITCODE -gt 7) {
        throw "Robocopy failed with exit code $LASTEXITCODE."
    }

    Write-Step `
        -Number 4 `
        -Total 7 `
        -Message "Compressing source archive"

    # .NET zip classes instead of PowerShell 5's own zip cmdlet, which does
    # not exist on Windows Server 2012 R2 (PowerShell 4.0) - a server this
    # helper may well run on.
    if (Test-Path $SourceArchive) {
        Remove-Item -LiteralPath $SourceArchive -Force
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $StageDirectory,
        $SourceArchive,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    if (-not (Test-Path $SourceArchive)) {
        throw "Source archive was not created."
    }

    Write-Step `
        -Number 5 `
        -Total 7 `
        -Message "Copying environment and documentation"

    Copy-Item `
        $EnvironmentFile `
        $SecretEnvironmentBackup `
        -Force

    $OptionalFiles = @(
        ".env.example"
        "docs\PROJECT_HANDOFF.md"
        "scripts\restore-windows.ps1"
    )

    foreach ($RelativePath in $OptionalFiles) {
        $SourcePath = Join-Path `
            $ProjectRoot `
            $RelativePath

        if (Test-Path $SourcePath) {
            Copy-Item `
                $SourcePath `
                $PackageDirectory `
                -Force
        }
    }

    Write-Step `
        -Number 6 `
        -Total 7 `
        -Message "Writing metadata and SHA-256 checksums"

    $NodeVersion = "Unknown"
    $NpmVersion = "Unknown"

    try {
        $NodeVersion = (
            node --version
        ).Trim()
    }
    catch {}

    try {
        $NpmVersion = (
            npm --version
        ).Trim()
    }
    catch {}

    # (Note: Rest of metadata writing blocks omitted for script structural integrity)
}
catch {
    Write-Error "Backup failed: $($_.Exception.Message)"
    exit 1
}
