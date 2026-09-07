[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BackupPackage,

    [string]$RestoreRoot = "C:\woodtek-erp-restored",

    [string]$PostgresBin = "",

    [switch]$OverwriteSource,

    [switch]$SkipDatabase,

    [switch]$SkipBuild,

    [switch]$Force
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

function Find-PostgresTool {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ToolName,

        [string]$PreferredBin
    )

    if ($PreferredBin) {
        $PreferredPath = Join-Path `
            $PreferredBin `
            "$ToolName.exe"

        if (Test-Path $PreferredPath) {
            return $PreferredPath
        }
    }

    $Command = Get-Command `
        "$ToolName.exe" `
        -ErrorAction SilentlyContinue

    if ($Command) {
        return $Command.Source
    }

    foreach ($Version in @(
        "18",
        "17",
        "16",
        "15",
        "14"
    )) {
        $Candidate = Join-Path `
            "C:\Program Files\PostgreSQL\$Version\bin" `
            "$ToolName.exe"

        if (Test-Path $Candidate) {
            return $Candidate
        }
    }

    throw @"
$ToolName.exe was not found.

Install PostgreSQL command-line tools or pass:

-PostgresBin "C:\Program Files\PostgreSQL\18\bin"
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
        throw "DATABASE_URL is missing from .env"
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

function Test-Checksums {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PackageDirectory
    )

    $ChecksumFile = Join-Path `
        $PackageDirectory `
        "SHA256SUMS.txt"

    if (-not (Test-Path $ChecksumFile)) {
        Write-Warning "SHA256SUMS.txt is missing. Integrity verification skipped."
        return
    }

    $ExpectedHashes = @{}

    Get-Content $ChecksumFile |
        ForEach-Object {
            if (
                $_ -match "^([a-fA-F0-9]{64})\s+(.+)$"
            ) {
                $ExpectedHashes[
                    $Matches[2]
                ] = $Matches[1].ToLower()
            }
        }

    foreach ($FileName in $ExpectedHashes.Keys) {
        $FilePath = Join-Path `
            $PackageDirectory `
            $FileName

        if (-not (Test-Path $FilePath)) {
            throw "Backup file is missing: $FileName"
        }

        $ActualHash = (
            Get-FileHash `
                -Path $FilePath `
                -Algorithm SHA256
        ).Hash.ToLower()

        if (
            $ActualHash -ne
            $ExpectedHashes[$FileName]
        ) {
            throw "Checksum mismatch: $FileName"
        }
    }
}

$BackupPackage = (
    Resolve-Path $BackupPackage
).Path

$TemporaryExtractDirectory = $null

if (
    Test-Path `
        -Path $BackupPackage `
        -PathType Leaf
) {
    if (
        [System.IO.Path]::GetExtension(
            $BackupPackage
        ) -ne ".zip"
    ) {
        throw "BackupPackage must be a backup directory or .zip file."
    }

    $TemporaryExtractDirectory = Join-Path `
        $env:TEMP `
        (
            "WoodTek_Restore_" +
            [guid]::NewGuid().ToString("N")
        )

    New-Item `
        -ItemType Directory `
        -Path $TemporaryExtractDirectory `
        -Force |
        Out-Null

    Expand-Archive `
        -Path $BackupPackage `
        -DestinationPath $TemporaryExtractDirectory `
        -Force

    $PackageDirectory = $TemporaryExtractDirectory
}
else {
    $PackageDirectory = $BackupPackage
}

$SourceArchive = Join-Path `
    $PackageDirectory `
    "woodtek_source.zip"

$DatabaseBackup = Join-Path `
    $PackageDirectory `
    "woodtek_database.backup"

$SecretEnvironmentBackup = Join-Path `
    $PackageDirectory `
    "woodtek.env.SECRET"

Write-Host ""
Write-Host "WoodTek ERP Restore" -ForegroundColor Cyan
Write-Host "===================" -ForegroundColor Cyan
Write-Host "Package : $PackageDirectory"
Write-Host "Restore : $RestoreRoot"
Write-Host ""

try {
    Write-Step `
        -Number 1 `
        -Total 7 `
        -Message "Verifying backup integrity"

    Test-Checksums `
        -PackageDirectory $PackageDirectory

    if (-not (Test-Path $SourceArchive)) {
        throw "woodtek_source.zip is missing."
    }

    if (
        -not $SkipDatabase -and
        -not (Test-Path $DatabaseBackup)
    ) {
        throw "woodtek_database.backup is missing."
    }

    if (-not $Force) {
        Write-Host ""
        Write-Warning @"
Restore can:
- Replace application source files
- Replace all tables and data in DATABASE_URL
- Restore old credentials and AUTH_SECRET

Use a test database first.
"@

        $Confirmation = Read-Host `
            "Type RESTORE to continue"

        if ($Confirmation -cne "RESTORE") {
            throw "Restore cancelled."
        }
    }

    Write-Step `
        -Number 2 `
        -Total 7 `
        -Message "Stopping Node processes"

    Get-Process node `
        -ErrorAction SilentlyContinue |
        Stop-Process `
            -Force `
            -ErrorAction SilentlyContinue

    Write-Step `
        -Number 3 `
        -Total 7 `
        -Message "Restoring application source"

    if (Test-Path $RestoreRoot) {
        if (-not $OverwriteSource) {
            throw @"
$RestoreRoot already exists.

Use:
-OverwriteSource

only after backing up the current folder.
"@
        }

        Remove-Item `
            -LiteralPath $RestoreRoot `
            -Recurse `
            -Force
    }

    New-Item `
        -ItemType Directory `
        -Path $RestoreRoot `
        -Force |
        Out-Null

    Expand-Archive `
        -Path $SourceArchive `
        -DestinationPath $RestoreRoot `
        -Force

    if (Test-Path $SecretEnvironmentBackup) {
        Copy-Item `
            $SecretEnvironmentBackup `
            (Join-Path $RestoreRoot ".env") `
            -Force
    }
    else {
        Write-Warning @"
woodtek.env.SECRET is missing.

Copy .env.example to .env and configure it
before restoring the database or building.
"@
    }

    Write-Step `
        -Number 4 `
        -Total 7 `
        -Message "Restoring PostgreSQL database"

    if (-not $SkipDatabase) {
        $EnvironmentFile = Join-Path `
            $RestoreRoot `
            ".env"

        $DatabaseUrl = Get-DatabaseUrl `
            -EnvironmentFile $EnvironmentFile

        $PgRestore = Find-PostgresTool `
            -ToolName "pg_restore" `
            -PreferredBin $PostgresBin

        & $PgRestore `
            --dbname=$DatabaseUrl `
            --clean `
            --if-exists `
            --no-owner `
            --no-privileges `
            --exit-on-error `
            $DatabaseBackup

        if ($LASTEXITCODE -ne 0) {
            throw "pg_restore failed with exit code $LASTEXITCODE."
        }
    }
    else {
        Write-Host "Database restore skipped." `
            -ForegroundColor DarkYellow
    }

    Write-Step `
        -Number 5 `
        -Total 7 `
        -Message "Installing dependencies"

    Push-Location $RestoreRoot

    try {
        if (Test-Path "package-lock.json") {
            npm ci
        }
        else {
            npm install
        }

        if ($LASTEXITCODE -ne 0) {
            throw "npm dependency installation failed."
        }

        if (-not $SkipBuild) {
            Write-Step `
                -Number 6 `
                -Total 7 `
                -Message "Running type generation and TypeScript"

            npx next typegen

            if ($LASTEXITCODE -ne 0) {
                throw "Next.js type generation failed."
            }

            npm exec tsc -- `
                --noEmit `
                --pretty false

            if ($LASTEXITCODE -ne 0) {
                throw "TypeScript validation failed."
            }

            Write-Step `
                -Number 7 `
                -Total 7 `
                -Message "Creating production build"

            # Webpack is preferred on Windows because it avoids
            # the observed Turbopack /_global-error workStore bug.
            npx next build --webpack

            if ($LASTEXITCODE -ne 0) {
                throw "Production build failed."
            }

            $Manifest = Join-Path `
                $RestoreRoot `
                ".next\prerender-manifest.json"

            $BuildId = Join-Path `
                $RestoreRoot `
                ".next\BUILD_ID"

            if (
                -not (Test-Path $Manifest) -or
                -not (Test-Path $BuildId)
            ) {
                throw "Build completed without required Next.js artifacts."
            }
        }
        else {
            Write-Host "Typecheck/build skipped." `
                -ForegroundColor DarkYellow
        }
    }
    finally {
        Pop-Location
    }

    Write-Host ""
    Write-Host "Restore completed successfully." `
        -ForegroundColor Green

    Write-Host ""
    Write-Host "Application:"
    Write-Host $RestoreRoot `
        -ForegroundColor Cyan

    Write-Host ""
    Write-Host "Start command:"
    Write-Host "cd $RestoreRoot; npm start" `
        -ForegroundColor Cyan
}
catch {
    Write-Error "Restore failed: $($_.Exception.Message)"
    exit 1
}
finally {
    if (
        $TemporaryExtractDirectory -and
        (Test-Path $TemporaryExtractDirectory)
    ) {
        Remove-Item `
            $TemporaryExtractDirectory `
            -Recurse `
            -Force `
            -ErrorAction SilentlyContinue
    }
}