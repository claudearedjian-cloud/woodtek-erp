# ============================================================================
# WoodTek ERP - MIGRATION PACK BUILDER (run this on the CURRENT server)
# ----------------------------------------------------------------------------
# Collects everything the new server needs into ONE folder you can copy on a
# USB stick:
#     <app folder>\WoodTek-Migration\
#         db-<stamp>.dump        the database (orders, users, stock, audit...)
#         data-<stamp>.zip       the JSON overlay (dispatch, production plans,
#                                roles/menus, assembly projects, email config...)
#         .env.from-old-pc       the old .env, for reference only
#         README-MIGRATION.txt   what to do on the new server
#
# It is READ-ONLY for your factory data: it takes a fresh backup with the same
# script the nightly task uses and copies the files out. Nothing is deleted or
# changed here.
#
# Usage (double-click backup\prepare-migration.bat, or):
#   powershell -NoProfile -ExecutionPolicy Bypass -File backup\prepare-migration.ps1
#   ... -PackDir D:\WoodTek-Migration
# ============================================================================
param(
    [string]$PackDir = "",
    [string]$BackupRoot = ""
)

$ErrorActionPreference = "Stop"

# This script lives in <app folder>\backup\
$Root = Split-Path -Parent $PSScriptRoot
if (-not $PackDir) { $PackDir = Join-Path $Root "WoodTek-Migration" }
if (-not $BackupRoot) { $BackupRoot = Join-Path $Root "backups\nightly" }

function Say([string]$Message) { Write-Host $Message }

Say "=================================================================="
Say " WoodTek ERP - prepare the factory data for the new server"
Say "=================================================================="
Say ""

# ---------------------------------------------------------------------------
# Sanity: is this really an installed WoodTek ERP folder?
# ---------------------------------------------------------------------------
$EnvFile = Join-Path $Root ".env"
$Launcher = Join-Path $Root "start-prod.cjs"
if (-not (Test-Path $EnvFile)) {
    throw "No .env found at $EnvFile. Run this from the WoodTek ERP folder (backup\prepare-migration.bat)."
}
if (-not (Test-Path $Launcher)) {
    throw "$Launcher not found - this folder does not look like a WoodTek ERP installation."
}
if (-not (Select-String -Path $EnvFile -Pattern '^\s*DATABASE_URL\s*=' -Quiet)) {
    throw "DATABASE_URL is missing from $EnvFile."
}

# ---------------------------------------------------------------------------
# 1. Fresh backup (database dump + data\ zip) with the nightly script
# ---------------------------------------------------------------------------
$BackupScript = Join-Path $PSScriptRoot "backup-woodtek.ps1"
if (-not (Test-Path $BackupScript)) {
    throw "backup\backup-woodtek.ps1 was not found next to this script."
}

Say "[1/4] Taking a fresh database + data backup (this can take a minute)..."
$backupArgs = @(
    "-NoProfile", "-ExecutionPolicy", "Bypass",
    "-File", "`"$BackupScript`"",
    "-BackupRoot", "`"$BackupRoot`""
)
& powershell.exe @backupArgs
if ($LASTEXITCODE -ne 0) {
    $BackupLog = Join-Path $BackupRoot "backup-woodtek.log"
    if (Test-Path $BackupLog) {
        Say "  The last lines of the backup log:"
        Get-Content $BackupLog -Tail 6 | ForEach-Object { Say "    $_" }
    }
    throw "The backup failed, so nothing was packed. Fix the backup first (log: $BackupLog)."
}
Say ""

# ---------------------------------------------------------------------------
# 2. Pick the newest dump and its matching data zip
# ---------------------------------------------------------------------------
Say "[2/4] Collecting the newest backup files..."
$Dump = Get-ChildItem $BackupRoot -File -Filter "db-*.dump" -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $Dump) { throw "No db-*.dump found in $BackupRoot." }

$Stamp = $Dump.BaseName -replace '^db-', ''
$DataZip = Get-Item (Join-Path $BackupRoot "data-$Stamp.zip") -ErrorAction SilentlyContinue
if (-not $DataZip) {
    $DataZip = Get-ChildItem $BackupRoot -File -Filter "data-*.zip" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
}

# A data\ folder with files but no zip would silently lose the JSON overlay
# (dispatch batches, production plans, roles/menus, assembly projects...).
$DataDir = if ($env:WOODTEK_DATA_DIR) { $env:WOODTEK_DATA_DIR } else { Join-Path $Root "data" }
$DataFileCount = 0
if (Test-Path $DataDir) {
    $DataFileCount = (Get-ChildItem $DataDir -File -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count
}
if ($DataFileCount -gt 0 -and -not $DataZip) {
    throw "The data\ folder holds $DataFileCount file(s) but no data-*.zip was produced - refusing to pack an incomplete migration."
}
Say "  database : $($Dump.Name)  ($([math]::Round($Dump.Length / 1MB, 1)) MB)"
if ($DataZip) {
    Say "  data     : $($DataZip.Name)  ($([math]::Round($DataZip.Length / 1MB, 1)) MB)"
} else {
    Say "  data     : (the data\ folder is empty - nothing to carry over)"
}
Say ""

# ---------------------------------------------------------------------------
# 3. Build the pack
# ---------------------------------------------------------------------------
Say "[3/4] Writing the migration pack to:"
Say "       $PackDir"
if (-not (Test-Path $PackDir)) {
    New-Item -ItemType Directory -Path $PackDir -Force | Out-Null
}
Copy-Item -Path $Dump.FullName -Destination (Join-Path $PackDir $Dump.Name) -Force
if ($DataZip) {
    Copy-Item -Path $DataZip.FullName -Destination (Join-Path $PackDir $DataZip.Name) -Force
}
# Reference copy only: the new server generates its own .env (its own
# DATABASE_URL). Keep this one so any custom value can be copied by hand.
Copy-Item -Path $EnvFile -Destination (Join-Path $PackDir ".env.from-old-pc") -Force

$Build = "unknown"
try {
    $BuildSha = (& git -C $Root rev-parse --short HEAD 2>$null) -join ""
    if ($BuildSha) { $Build = $BuildSha }
} catch { }

$Readme = @"
WoodTek ERP - migration pack
==================================================================
Made on   : $env:COMPUTERNAME   ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))
App build : $Build
Database  : $($Dump.Name)
Data files: $(if ($DataZip) { $DataZip.Name } else { "none (data\ folder was empty)" })

WHAT TO DO ON THE NEW SERVER
  1. Install WoodTek ERP there first
     (run WoodTek-ERP-Setup.exe and let it finish).
  2. Copy this whole folder to the new server, for example to
     the Desktop.
  3. On the new server double-click:
        <install folder>\installer\restore-migration.bat
     It finds this folder, replaces the new server's fresh, empty
     database with the factory data, restores the data\ files and
     starts the app again.

NOTES
  - This pack is a copy: the server that made it is NOT changed.
  - ".env.from-old-pc" is for reference only. Do not overwrite the new
    server's .env with it unless you know why (the new one points at
    its own local PostgreSQL).
  - Until the new server is checked, keep the old PC switched on and
    keep this pack somewhere safe.
"@
$ReadmePath = Join-Path $PackDir "README-MIGRATION.txt"
[System.IO.File]::WriteAllText($ReadmePath, $Readme, [System.Text.Encoding]::UTF8)

Say ""
Say "[4/4] Pack ready. Contents:"
Get-ChildItem $PackDir -File | Sort-Object Name | ForEach-Object {
    Say ("       {0,-26} {1,8} MB" -f $_.Name, [math]::Round($_.Length / 1MB, 2))
}
Say ""
Say "NEXT: install WoodTek ERP on the new server, copy this folder there"
Say "      (Desktop is fine) and run installer\restore-migration.bat on it."
Say ""
