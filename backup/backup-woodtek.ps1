#requires -Version 5.1
<#
=============================================================================
WoodTek ERP - nightly backup (Postgres database + JSON data overlay).

Captures:
  1. A custom-format pg_dump of the application database (compact, fast to
     restore, the relational source of truth: orders, operations, machines,
     stock, users, audit...).
  2. A zip of the WOODTEK_DATA_DIR JSON overlay (reception, candidate offers,
     dispatch state, BOM status, role/menu config - everything under data\).

Outputs (default: <app root>\backups\nightly):
  db-<yyyyMMdd-HHmm>.dump   data-<yyyyMMdd-HHmm>.zip   backup-woodtek.log

Retention: files older than -RetentionDays (default 14) are deleted after
each successful run. Exits 0 on success, 1 on failure (schtasks records the
code; the log line says why).

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File backup-woodtek.ps1
  ... -RetentionDays 21 -BackupRoot D:\woodtek-backups
=============================================================================
#>
param(
  [int]$RetentionDays = 14,
  [string]$BackupRoot = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot          # this script lives in <root>\backup\
if (-not $BackupRoot) { $BackupRoot = Join-Path $Root "backups\nightly" }
$LogFile = Join-Path $BackupRoot "backup-woodtek.log"

function Write-Log([string]$Line) {
  $Entry = (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " " + $Line
  try { Add-Content -Path $LogFile -Value $Entry -Encoding UTF8 } catch { }
  Write-Host $Entry
}

if (-not (Test-Path $BackupRoot)) {
  New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null
}

# ---- single-instance guard (stale lock = older than 1 hour) ---------------
$LockFile = Join-Path $BackupRoot "backup.lock"
if (Test-Path $LockFile) {
  $Age = (Get-Date).AddHours(-1) - (Get-Item $LockFile).LastWriteTime
  if ($Age -lt [TimeSpan]::Zero) {
    Write-Log "FAIL previous backup is still running - skipped"
    exit 1
  }
  Remove-Item $LockFile -Force
}
$LockFile | Out-File -Encoding ASCII
try {
  # ---- locate the database credentials from the app .env ------------------
  $EnvFile = Join-Path $Root ".env"
  if (-not (Test-Path $EnvFile)) { throw "no .env found at $EnvFile" }
  $UrlMatch = Select-String -Path $EnvFile -Pattern '^\s*DATABASE_URL\s*=\s*(.+?)\s*$' | Select-Object -First 1
  if (-not $UrlMatch) { throw "DATABASE_URL is not set in .env" }
  $Url = $UrlMatch.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")

  $DbInfo = $null
  if ($Url -match '^(?:postgres|postgresql)://([^:@/]+)(?::([^@/]*))?@([^:/]+)(?::(\d+))?/(\w+)') {
    $DbInfo = @{
      User = $Matches[1]
      Pass = $Matches[2]
      Host = $Matches[3]
      Port = if ($Matches[4]) { $Matches[4] } else { "5432" }
      Db   = $Matches[5]
    }
  } else {
    throw "could not parse DATABASE_URL from .env"
  }

  # ---- locate pg_dump ------------------------------------------------------
  $PgDump = $null
  $Cmd = Get-Command pg_dump -ErrorAction SilentlyContinue
  if ($Cmd) { $PgDump = $Cmd.Source }
  else {
    $PgBase = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
      Sort-Object Name -Descending | Select-Object -First 1
    if ($PgBase) {
      $Candidate = Join-Path $PgBase.FullName "bin\pg_dump.exe"
      if (Test-Path $Candidate) { $PgDump = $Candidate }
    }
  }
  if (-not $PgDump) { throw "pg_dump not found (install PostgreSQL client tools or add it to PATH)" }

  # ---- dump the database ---------------------------------------------------
  $Ts = Get-Date -Format "yyyyMMdd-HHmm"
  $DbDump = Join-Path $BackupRoot "db-$Ts.dump"
  if ($DbInfo.Pass) { $env:PGPASSWORD = $DbInfo.Pass }
  try {
    & $PgDump --host=$($DbInfo.Host) --port=$($DbInfo.Port) --username=$($DbInfo.User) `
      --format=custom --no-password --file=$DbDump $DbInfo.Db
    if ($LASTEXITCODE -ne 0) { throw "pg_dump exited with code $LASTEXITCODE" }
  } finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
  }

  # ---- zip the JSON data overlay -------------------------------------------
  $DataDir = if ($env:WOODTEK_DATA_DIR) { $env:WOODTEK_DATA_DIR } else { Join-Path $Root "data" }
  $DataZip = ""
  if ((Test-Path $DataDir) -and (Get-ChildItem $DataDir -File -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0) {
    $DataZip = Join-Path $BackupRoot "data-$Ts.zip"
    Compress-Archive -Path (Join-Path $DataDir "*") -DestinationPath $DataZip -Force
  }

  # ---- commit stamp (which code this backup pairs with) ---------------------
  $Commit = "unknown"
  try { $Commit = (& git -C $Root rev-parse --short HEAD 2>$null) -join "" } catch { }

  # ---- retention -------------------------------------------------------------
  $Cutoff = (Get-Date).AddDays(-$RetentionDays)
  $Removed = 0
  foreach ($Pattern in @("db-*.dump", "data-*.zip")) {
    $Old = Get-ChildItem $BackupRoot -File -Filter $Pattern -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -lt $Cutoff }
    foreach ($F in $Old) { Remove-Item $F.FullName -Force; $Removed++ }
  }

  $DbSize = [math]::Round((Get-Item $DbDump).Length / 1MB, 1)
  $ZipSize = if ($DataZip) { [math]::Round((Get-Item $DataZip).Length / 1MB, 1) } else { 0 }
  Write-Log ("OK db=$DbDump ({0} MB) data={1} ({2} MB) commit={3} removed-old={4}" -f $DbSize, $(if ($DataZip) { "zipped" } else { "none" }), $ZipSize, $Commit, $Removed)
  exit 0
} catch {
  Write-Log ("FAIL " + $_.Exception.Message)
  exit 1
} finally {
  Remove-Item $LockFile -Force -ErrorAction SilentlyContinue
  if ($env:PGPASSWORD) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
}
