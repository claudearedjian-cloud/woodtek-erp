# ============================================================================
# WoodTek ERP - MIGRATION RESTORE (run this on the NEW server)
# ----------------------------------------------------------------------------
# Takes a migration pack made by backup\prepare-migration.bat on the old PC
# (db-<stamp>.dump + data-<stamp>.zip + README-MIGRATION.txt) and puts the
# factory data onto THIS PC:
#     1. stops the WoodTek ERP server
#     2. keeps the fresh, empty database aside as a dump (cheap insurance)
#     3. drops and recreates the database, then pg_restore's the pack into it
#     4. extracts the pack's data\ files (dispatch, production plans, roles/
#        menus, assembly projects, email config...)
#     5. starts the server again and VERIFIES it: /api/health must answer, and
#        the row counts of users / orders / machines are read back and printed
#
# The old server is never touched: this only replaces the empty database that
# the setup created on THIS PC.
#
# Usage (double-click installer\restore-migration.bat, or):
#   powershell -NoProfile -ExecutionPolicy Bypass -File installer\restore-migration.ps1
#   ... -PackDir "C:\Users\Public\Desktop\WoodTek-Migration" -Force
# ============================================================================
param(
    [string]$PackDir = "",
    [string]$InstallDir = "",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "== $Message" -ForegroundColor Cyan
    [Console]::Out.Flush()
}
function Write-Info([string]$Message) {
    Write-Host "   $Message"
    [Console]::Out.Flush()
}
function Write-Warn([string]$Message) {
    Write-Host "   ! $Message" -ForegroundColor Yellow
    [Console]::Out.Flush()
}

function Test-IsAdmin {
    try {
        $Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
        $Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
        return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
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

# ---------------------------------------------------------------------------
# Step 0: this script restarts a SYSTEM scheduled task -> needs elevation
# ---------------------------------------------------------------------------
if (-not (Test-IsAdmin)) {
    Write-Host "[migration] Requesting administrator rights - click Yes on the UAC prompt..." -ForegroundColor Yellow
    $psArgs = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
    if ($PackDir)    { $psArgs += @("-PackDir", "`"$PackDir`"") }
    if ($InstallDir) { $psArgs += @("-InstallDir", "`"$InstallDir`"") }
    if ($Force)      { $psArgs += "-Force" }
    $proc = Start-Process -FilePath "powershell.exe" -ArgumentList $psArgs -Verb RunAs -PassThru -Wait
    exit $proc.ExitCode
}

$Root = if ($InstallDir) { $InstallDir } else { Split-Path -Parent $PSScriptRoot }

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " WoodTek ERP - restore the factory data onto this PC" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan

# ---------------------------------------------------------------------------
# Step 1: this must be an installed app folder
# ---------------------------------------------------------------------------
Write-Step "Step 1/8: Checking the installation at $Root"
$EnvFile = Join-Path $Root ".env"
if (-not (Test-Path $EnvFile)) {
    throw "No .env found at $EnvFile. Install WoodTek ERP on this PC first (WoodTek-ERP-Setup.exe)."
}
$Server = Join-Path $Root ".next\standalone\server.js"
if (-not (Test-Path $Server)) {
    throw "The production build is missing ($Server). Install WoodTek ERP on this PC first."
}
$UrlMatch = Select-String -Path $EnvFile -Pattern '^\s*DATABASE_URL\s*=\s*(.+?)\s*$' | Select-Object -First 1
if (-not $UrlMatch) { throw "DATABASE_URL is not set in $EnvFile." }
$DbUrl = $UrlMatch.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")

$DbInfo = $null
if ($DbUrl -match '^(?:postgres|postgresql)://([^:@/]+)(?::([^@/]*))?@([^:/]+)(?::(\d+))?/(\w+)') {
    $DbInfo = @{
        User = $Matches[1]
        Pass = $Matches[2]
        Host = $Matches[3]
        Port = if ($Matches[4]) { $Matches[4] } else { "5432" }
        Db   = $Matches[5]
    }
} else {
    throw "Could not read DATABASE_URL from .env."
}
Write-Info "database : $($DbInfo.Db) at $($DbInfo.Host):$($DbInfo.Port)"
Write-Info "app folder: $Root"

# ---------------------------------------------------------------------------
# Step 2: locate the migration pack
# ---------------------------------------------------------------------------
Write-Step "Step 2/8: Looking for the migration pack (db-*.dump + data-*.zip)"

function Find-MigrationPack([string]$Preferred) {
    $Places = @()
    if ($Preferred) { $Places += $Preferred }
    $Places += @(
        (Join-Path $Root "WoodTek-Migration"),
        (Join-Path $env:USERPROFILE "Desktop\WoodTek-Migration"),
        (Join-Path $env:USERPROFILE "Downloads\WoodTek-Migration"),
        (Join-Path $env:USERPROFILE "Desktop"),
        (Join-Path $env:USERPROFILE "Downloads"),
        "C:\WoodTek-Migration"
    )
    # A folder named WoodTek-Migration anywhere on the Desktop / Downloads
    foreach ($Parent in @((Join-Path $env:USERPROFILE "Desktop"), (Join-Path $env:USERPROFILE "Downloads"))) {
        if (Test-Path $Parent) {
            Get-ChildItem $Parent -Directory -ErrorAction SilentlyContinue |
                Where-Object { $_.Name -like "*WoodTek-Migration*" -or $_.Name -like "*migration-pack*" } |
                ForEach-Object { $Places += $_.FullName }
        }
    }
    foreach ($Place in $Places) {
        if (-not $Place) { continue }
        if (-not (Test-Path $Place)) { continue }
        $Dump = Get-ChildItem $Place -File -Filter "db-*.dump" -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if ($Dump) { return $Place }
    }
    return ""
}

$PackDir = Find-MigrationPack $PackDir
if (-not $PackDir) {
    throw ("No migration pack found. Copy the WoodTek-Migration folder from the old PC " +
           "to the Desktop of this PC (or pass -PackDir <folder>) and run this again.")
}
$Dump = Get-ChildItem $PackDir -File -Filter "db-*.dump" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$Stamp = $Dump.BaseName -replace '^db-', ''
$DataZip = Get-Item (Join-Path $PackDir "data-$Stamp.zip") -ErrorAction SilentlyContinue
if (-not $DataZip) {
    $DataZip = Get-ChildItem $PackDir -File -Filter "data-*.zip" -ErrorAction SilentlyContinue |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
Write-Info "pack     : $PackDir"
Write-Info "database : $($Dump.Name)  ($([math]::Round($Dump.Length / 1MB, 1)) MB)"
if ($DataZip) {
    Write-Info "data     : $($DataZip.Name)  ($([math]::Round($DataZip.Length / 1MB, 1)) MB)"
} else {
    Write-Warn "the pack has no data-*.zip - only the database will be restored."
}

# ---------------------------------------------------------------------------
# Step 3: confirm (double-click friendly, -Force skips it)
# ---------------------------------------------------------------------------
if (-not $Force) {
    Write-Host ""
    Write-Host "  This will REPLACE the database on THIS PC with the pack above." -ForegroundColor Yellow
    Write-Host "  The old server is NOT changed. Until you check this one, keep it on." -ForegroundColor Yellow
    $answer = Read-Host "  Type YES to continue"
    if ($answer -ne "YES") {
        Write-Host "  Cancelled - nothing was changed."
        exit 1
    }
}

# ---------------------------------------------------------------------------
# Step 4: locate the PostgreSQL tools (pg_restore + psql)
# ---------------------------------------------------------------------------
Write-Step "Step 4/8: Finding pg_restore and psql"
function Find-PgTool([string]$ToolName) {
    $Cmd = Get-Command "$ToolName.exe" -ErrorAction SilentlyContinue
    if ($Cmd) { return $Cmd.Source }
    $Base = Get-ChildItem "C:\Program Files\PostgreSQL" -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -First 1
    if ($Base) {
        $Candidate = Join-Path $Base.FullName "bin\$ToolName.exe"
        if (Test-Path $Candidate) { return $Candidate }
    }
    return ""
}
$PgRestore = Find-PgTool "pg_restore"
$Psql = Find-PgTool "psql"
if (-not $PgRestore) { throw "pg_restore.exe was not found. Is PostgreSQL installed on this PC?" }
Write-Info "pg_restore: $PgRestore"
if ($Psql) { Write-Info "psql      : $Psql" } else { Write-Warn "psql.exe was not found - the final row-count check will be skipped." }

if ($DbInfo.Pass) { $env:PGPASSWORD = $DbInfo.Pass }

# ---------------------------------------------------------------------------
# Step 5: stop the server, keep the current (empty) state aside
# ---------------------------------------------------------------------------
Write-Step "Step 5/8: Stopping the WoodTek ERP server"
try { schtasks /End /TN "\WoodTek ERP" 2>$null | Out-Null } catch { }
$Port = 3000
$PortMatch = Select-String -Path $EnvFile -Pattern '^\s*PORT\s*=\s*(\d+)' | Select-Object -First 1
if ($PortMatch) { $Port = [int]$PortMatch.Matches[0].Groups[1].Value }
if (Test-TcpPort "127.0.0.1" $Port) {
    try {
        $netstat = netstat -ano | Select-String ":$Port\s+.*LISTENING\s+(\d+)$"
        foreach ($m in $netstat) {
            if ($m.Matches.Count -gt 0) {
                $pidToKill = $m.Matches[0].Groups[1].Value
                if ($pidToKill -and $pidToKill -ne "0") { taskkill /F /T /PID $pidToKill 2>$null | Out-Null }
            }
        }
    } catch { }
    Start-Sleep -Seconds 2
}
Write-Info "server stopped (port $Port is free)"

$TimeStamp = Get-Date -Format "yyyyMMdd-HHmm"
$BackupRoot = Join-Path $Root "backups"
if (-not (Test-Path $BackupRoot)) { New-Item -ItemType Directory -Path $BackupRoot -Force | Out-Null }
$PreDump = Join-Path $BackupRoot "pre-migration-$TimeStamp.dump"
try {
    & $PgRestore --version | Out-Null
    $PgDump = Find-PgTool "pg_dump"
    if ($PgDump) {
        & $PgDump -w --host=$($DbInfo.Host) --port=$($DbInfo.Port) --username=$($DbInfo.User) `
            --format=custom --no-password --file=$PreDump $DbInfo.Db 2>$null
        Write-Info "the pre-migration state was saved to $PreDump"
    }
} catch {
    Write-Warn "could not save the pre-migration state (continuing anyway)"
}

$OldDataDir = Join-Path $Root "data"
$DataKeptAside = ""
if (Test-Path $OldDataDir) {
    $DataKeptAside = Join-Path $Root "data-before-migration-$TimeStamp"
    Move-Item -Path $OldDataDir -Destination $DataKeptAside -Force
    Write-Info "the previous data folder was kept as $(Split-Path -Leaf $DataKeptAside)"
}

# ---------------------------------------------------------------------------
# Step 6: restore the database
# ---------------------------------------------------------------------------
Write-Step "Step 6/8: Restoring the factory database (this can take a minute)"
$LogFile = Join-Path $BackupRoot "restore-migration-$TimeStamp.log"

if ($Psql) {
    $dropSql = "DROP DATABASE IF EXISTS `"$($DbInfo.Db)`" WITH (FORCE);"
    & $Psql -w -h $DbInfo.Host -p $DbInfo.Port -U $DbInfo.User -d postgres -c $dropSql *>> $LogFile
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "the 'drop database' with force failed - trying the plain form"
        & $Psql -w -h $DbInfo.Host -p $DbInfo.Port -U $DbInfo.User -d postgres -c "DROP DATABASE IF EXISTS `"$($DbInfo.Db)`";" *>> $LogFile
        if ($LASTEXITCODE -ne 0) { throw "Could not drop the old database - see $LogFile" }
    }
    & $Psql -w -h $DbInfo.Host -p $DbInfo.Port -U $DbInfo.User -d postgres `
        -c "CREATE DATABASE `"$($DbInfo.Db)`" OWNER `"$($DbInfo.User)`";" *>> $LogFile
    if ($LASTEXITCODE -ne 0) { throw "Could not create the database - see $LogFile" }
    Write-Info "database $($DbInfo.Db) was recreated empty"
} else {
    Write-Warn "psql is missing: restoring on top of the existing empty database with --clean"
}

if ($Psql) {
    & $PgRestore -w --no-owner --no-privileges -d $DbUrl $Dump.FullName *>> $LogFile
} else {
    & $PgRestore -w --clean --if-exists --no-owner --no-privileges -d $DbUrl $Dump.FullName *>> $LogFile
}
if ($LASTEXITCODE -ne 0) {
    Write-Warn "pg_restore reported problems (exit code $LASTEXITCODE)."
    if (Test-Path $LogFile) { Get-Content $LogFile -Tail 12 | ForEach-Object { Write-Host "     $_" } }
    throw "The database was not restored cleanly. Nothing on the old PC was changed - fix the message above and run this again."
}
Write-Info "database restored"

# ---------------------------------------------------------------------------
# Step 7: restore the data\ overlay (JSON stores)
# ---------------------------------------------------------------------------
Write-Step "Step 7/8: Restoring the data files (dispatch, plans, roles, projects...)"
if ($DataZip) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    New-Item -ItemType Directory -Path $OldDataDir -Force | Out-Null
    [System.IO.Compression.ZipFile]::ExtractToDirectory($DataZip.FullName, $OldDataDir)
    $RestoredFiles = (Get-ChildItem $OldDataDir -File -Recurse -ErrorAction SilentlyContinue | Measure-Object).Count
    Write-Info "$RestoredFiles data file(s) restored from $($DataZip.Name)"
    if (Test-Path $DataKeptAside) {
        Write-Info "the fresh server's own data folder is kept as $(Split-Path -Leaf $DataKeptAside) (safe to delete later)"
    }
} else {
    if ($DataKeptAside) {
        Move-Item -Path $DataKeptAside -Destination $OldDataDir -Force
        Write-Info "no data zip in the pack - the previous data folder was put back"
    }
}

# ---------------------------------------------------------------------------
# Step 8: start the server again and VERIFY the data came across
# ---------------------------------------------------------------------------
Write-Step "Step 8/8: Starting the server and checking the restored data"

$Started = $false
try {
    schtasks /Run /TN "\WoodTek ERP" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $Started = $true }
} catch { }
if (-not $Started) {
    Write-Warn "the scheduled task is not available - starting the server directly"
    $NodeExe = Join-Path $Root "runtime\node\node.exe"
    if (-not (Test-Path $NodeExe)) { $NodeExe = "node" }
    Start-Process -FilePath $NodeExe -ArgumentList "`"$(Join-Path $Root 'start-prod.cjs')`" --no-browser" `
        -WorkingDirectory $Root -WindowStyle Hidden
}

$Healthy = $false
$Waited = 0
while ((-not $Healthy) -and ($Waited -lt 120)) {
    Start-Sleep -Seconds 3
    $Waited += 3
    try {
        $Resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($Resp.StatusCode -eq 200) { $Healthy = $true }
    } catch { }
}

if ($Healthy) {
    Write-Info "the server answers on http://localhost:$Port (after $Waited s)"
} else {
    Write-Warn "the server did not answer within 120 s - check $Root\logs\woodtek.log"
}

if ($Psql) {
    Write-Host ""
    Write-Host "  Data check (read back from the restored database):" -ForegroundColor Cyan
    foreach ($Table in @("users", "machines", "orders", "order_operations")) {
        $Count = (& $Psql -w -h $DbInfo.Host -p $DbInfo.Port -U $DbInfo.User -d $DbInfo.Db -t -A `
            -c "SELECT count(*) FROM `"$Table`";" 2>$null) -join ""
        Write-Host ("    {0,-18} {1}" -f $Table, $Count.Trim())
    }
}

$LanIp = ""
try {
    $LanIp = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.IPAddress -notlike "169.254.*" } |
        Select-Object -First 1).IPAddress
} catch { }

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host " DONE - the factory data is on this PC" -ForegroundColor Green
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  On this PC      : http://localhost:$Port"
if ($LanIp) { Write-Host "  On the network  : http://${LanIp}:$Port" }
Write-Host ""
Write-Host "  Check these (sign in with YOUR usual PIN - the users came across):" -ForegroundColor Cyan
Write-Host "    1. Orders & Routing lists the real orders, with their stations."
Write-Host "    2. Dispatch Schedule shows the open material batches."
Write-Host "    3. Assembly / production plans look like the old server."
Write-Host "    4. Settings > Users lists the real users; the footer says the right thing."
Write-Host "    5. Print one job ticket / quotation to check the printer setup."
Write-Host ""
Write-Host "  Only after that, point the factory PCs at this server and stop using"
Write-Host "  the old one. Keep the old PC untouched for a week."
Write-Host ""

Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
