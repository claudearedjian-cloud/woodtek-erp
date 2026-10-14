# NOTE: no "#requires -Version 5.1" line here on purpose (removed 2026-10-14).
# On Windows Server 2012 R2 (PowerShell 4.0) it made this whole script refuse
# to run - the nightly backup failed silently and the pre-update dump with it.
# The body below uses only PowerShell 4.0 features; keep it that way.
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

function Get-EnvFileValue([string]$EnvFile, [string]$Key) {
  if (-not $EnvFile -or -not (Test-Path $EnvFile)) { return "" }
  $match = Select-String -Path $EnvFile -Pattern ("^\s*" + [regex]::Escape($Key) + "\s*=\s*(.+?)\s*$") | Select-Object -First 1
  if (-not $match) { return "" }
  return $match.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
}

function Get-PgBinDirs([string]$EnvFile) {
  # Every plausible place the PostgreSQL command-line tools can live on Windows,
  # in order of trust. 2026-10-14: the first version of this lookup only tried
  # PATH and "C:\Program Files\PostgreSQL\<newest>\bin", so the migration pack
  # died with "pg_dump not found" on a PC whose PostgreSQL sits somewhere else.
  $dirs = @()

  # 1. explicit override: environment variable first, then WOODTEK_PG_BIN in .env
  $override = ""
  if ($env:WOODTEK_PG_BIN) { $override = $env:WOODTEK_PG_BIN } else { $override = Get-EnvFileValue $EnvFile "WOODTEK_PG_BIN" }
  if ($override) { $dirs += $override }

  # 2. the EDB installer records where it put PostgreSQL
  foreach ($root in @("HKLM:\SOFTWARE\PostgreSQL\Installations", "HKLM:\SOFTWARE\WOW6432Node\PostgreSQL\Installations")) {
    if (Test-Path $root) {
      Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
        $base = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue)."Base Directory"
        if ($base) { $dirs += (Join-Path $base "bin") }
      }
    }
  }

  # 3. a running PostgreSQL service: its own executable names the real folder,
  #    whatever the install path was
  try {
    $services = Get-WmiObject Win32_Service -Filter "Name LIKE 'postgresql%'" -ErrorAction SilentlyContinue
    foreach ($service in $services) {
      $exePath = "$($service.PathName)".Trim()
      if (-not $exePath) { continue }
      if ($exePath.StartsWith('"')) {
        $end = $exePath.IndexOf('"', 1)
        if ($end -gt 1) { $exePath = $exePath.Substring(1, $end - 1) }
      } else {
        $exePath = ($exePath -split '\s+')[0]
      }
      $serviceDir = Split-Path -Parent $exePath
      if ($serviceDir) { $dirs += $serviceDir }
    }
  } catch { }

  # 4. the usual folders - every version subfolder, on every common drive
  $roots = @()
  if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles "PostgreSQL") }
  if (${env:ProgramFiles(x86)}) { $roots += (Join-Path ${env:ProgramFiles(x86)} "PostgreSQL") }
  foreach ($drive in @("C:", "D:", "E:")) {
    $roots += "$drive\PostgreSQL"
    $roots += "$drive\pgsql"
  }
  foreach ($root in $roots) {
    if ($root -and (Test-Path $root)) {
      $dirs += $root
      Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object { $dirs += (Join-Path $_.FullName "bin") }
    }
  }

  return ($dirs | Where-Object { $_ } | Select-Object -Unique)
}

function Find-PgTool([string]$ToolName, [string]$EnvFile) {
  foreach ($dir in (Get-PgBinDirs $EnvFile)) {
    $candidate = Join-Path $dir "$ToolName.exe"
    if (Test-Path $candidate) { return $candidate }
  }
  $command = Get-Command "$ToolName.exe" -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return ""
}

# Any failure - including one before the main try block below (an unreadable
# folder, a bad lock file) - must leave a line in backup-woodtek.log. A nightly
# task that fails silently is how a broken backup stays unnoticed for months.
trap {
  Write-Log ("FAIL " + $_.Exception.Message)
  if ($LockFile) { Remove-Item -LiteralPath $LockFile -Force -ErrorAction SilentlyContinue }
  exit 1
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
# Create the lock file (existence + timestamp are all the guard needs).
# NOTE: 2026-10-14 - this used to pipe the path into Out-File without giving it
# a -FilePath, so it threw "the value of argument path is null" and, with
# ErrorActionPreference = Stop, aborted every run before the try block - which
# is why the nightly task failed silently and the log never said why.
New-Item -Path $LockFile -ItemType File -Force | Out-Null
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
  # Checks WOODTEK_PG_BIN (environment or .env), the registry, the running
  # PostgreSQL service, the usual install folders on C:/D:/E: - then PATH.
  $PgDump = Find-PgTool "pg_dump" $EnvFile
  if (-not $PgDump) {
    Write-Log ("pg_dump not found. Looked in: " + ((Get-PgBinDirs $EnvFile) -join " | ") + " | PATH")
    throw ("pg_dump was not found on this PC. Run backup\find-postgres-tools.bat for a diagnosis; " +
           "install the PostgreSQL command-line tools, or put WOODTEK_PG_BIN=<folder with pg_dump.exe> in .env.")
  }

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
    # .NET zip classes instead of PowerShell 5's own zip cmdlet: that cmdlet
    # does not exist on Windows Server 2012 R2 (PowerShell 4.0), which is what
    # the factory server may still be. Same zip format - and dot-files are
    # included too.
    if (Test-Path $DataZip) { Remove-Item -LiteralPath $DataZip -Force }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory(
      $DataDir,
      $DataZip,
      [System.IO.Compression.CompressionLevel]::Optimal,
      $false)
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
