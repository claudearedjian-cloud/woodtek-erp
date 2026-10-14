# ============================================================================
# WoodTek ERP - FIND THE POSTGRESQL TOOLS (diagnosis, safe, read-only*)
# ----------------------------------------------------------------------------
# Answers one question: where is pg_dump / psql / pg_restore on THIS PC?
# Run it when a backup, the migration pack or a restore says
# "pg_dump not found" or "pg_restore was not found".
#
# It prints:
#   1. which database the app talks to (host and name only - never the password)
#   2. the PostgreSQL services running on this PC and the folder each runs from
#   3. every folder that looks like a PostgreSQL install, and which tools it has
#   4. what to do next - and, when a folder with the tools is found, it offers
#      to write  WOODTEK_PG_BIN=<folder>  into .env (that is the switch the app,
#      the nightly backup, the migration pack and the restore all honour)
#
# *The only thing it can change is that one line in .env, and only after you
#  type YES.
# ============================================================================
param(
    [string]$InstallDir = "",
    [switch]$Yes
)

$ErrorActionPreference = "Continue"

$Root = if ($InstallDir) { $InstallDir } else { Split-Path -Parent $PSScriptRoot }
if (-not (Test-Path (Join-Path $Root "start-prod.cjs"))) {
    # scripts\ in the repo root is harmless for a diagnosis, but warn.
    Write-Host "Note: $Root does not look like the WoodTek ERP folder (no start-prod.cjs)." -ForegroundColor Yellow
}
$EnvFile = Join-Path $Root ".env"

function Say([string]$Message) { Write-Host $Message }
function Head([string]$Message) {
    Write-Host ""
    Write-Host "== $Message" -ForegroundColor Cyan
}

Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host " WoodTek ERP - where are the PostgreSQL tools on this PC?" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Say "  App folder: $Root"

# ---------------------------------------------------------------------------
# 1. the database this app talks to (host + database name only)
# ---------------------------------------------------------------------------
Head "1) The database this app uses"
$DbHost = ""
$DbPort = ""
$DbName = ""
if (Test-Path $EnvFile) {
    $match = Select-String -Path $EnvFile -Pattern '^\s*DATABASE_URL\s*=\s*(.+?)\s*$' | Select-Object -First 1
    if ($match) {
        $url = $match.Matches[0].Groups[1].Value.Trim().Trim('"').Trim("'")
        if ($url -match '^(?:postgres|postgresql)://([^:@/]+)(?::([^@/]*))?@([^:/]+)(?::(\d+))?/(\w+)') {
            $DbHost = $Matches[3]
            $DbPort = if ($Matches[4]) { $Matches[4] } else { "5432" }
            $DbName = $Matches[5]
            Say "  host : $DbHost : $DbPort"
            Say "  name : $DbName"
            Say "  (user and password are deliberately NOT printed)"
            if ($DbHost -ne "localhost" -and $DbHost -ne "127.0.0.1" -and $DbHost -ne "::1") {
                Say "  ! The database is on ANOTHER PC ($DbHost), so this PC needs the"
                Say "    PostgreSQL command-line tools installed, or the dump has to be"
                Say "    taken on $DbHost."
            }
        } else {
            Say "  (DATABASE_URL is set, but it could not be read as a host/name pair)"
        }
    } else {
        Say "  ! No DATABASE_URL found in $EnvFile"
    }
} else {
    Say "  ! No .env found at $EnvFile - is this the installed app folder?"
}

# ---------------------------------------------------------------------------
# 2. PostgreSQL services on this PC
# ---------------------------------------------------------------------------
Head "2) PostgreSQL running as a service on this PC"
$ServiceDirs = @()
try {
    $services = @()
    $wmiServices = Get-WmiObject Win32_Service -Filter "Name LIKE 'postgresql%'" -ErrorAction SilentlyContinue
    foreach ($svc in $wmiServices) {
        $exePath = "$($svc.PathName)".Trim()
        $svcDir = ""
        if ($exePath) {
            if ($exePath.StartsWith('"')) {
                $end = $exePath.IndexOf('"', 1)
                if ($end -gt 1) { $exePath = $exePath.Substring(1, $end - 1) }
            } else {
                $exePath = ($exePath -split '\s+')[0]
            }
            $svcDir = Split-Path -Parent $exePath
        }
        $services += [pscustomobject]@{ Name = $svc.Name; State = $svc.State; Folder = $svcDir }
        if ($svcDir) { $ServiceDirs += $svcDir }
    }
    if ($services.Count -eq 0) {
        Say "  (none - PostgreSQL is not running as a service on this PC)"
    } else {
        $services | Format-Table -AutoSize | Out-String -Width 200 | ForEach-Object { Say $_ }
    }
} catch {
    Say "  (could not read the service list: $($_.Exception.Message))"
}

# ---------------------------------------------------------------------------
# 3. folders that look like a PostgreSQL install, and what they contain
# ---------------------------------------------------------------------------
Head "3) PostgreSQL folders on this PC and the tools inside them"
$candidates = @()
$candidates += $ServiceDirs
foreach ($root in @("HKLM:\SOFTWARE\PostgreSQL\Installations", "HKLM:\SOFTWARE\WOW6432Node\PostgreSQL\Installations")) {
    if (Test-Path $root) {
        Get-ChildItem $root -ErrorAction SilentlyContinue | ForEach-Object {
            $base = (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue)."Base Directory"
            if ($base) { $candidates += (Join-Path $base "bin") }
        }
    }
}
$roots = @()
if ($env:ProgramFiles) { $roots += (Join-Path $env:ProgramFiles "PostgreSQL") }
if (${env:ProgramFiles(x86)}) { $roots += (Join-Path ${env:ProgramFiles(x86)} "PostgreSQL") }
foreach ($drive in @("C:", "D:", "E:")) {
    $roots += "$drive\PostgreSQL"
    $roots += "$drive\pgsql"
}
foreach ($root in $roots) {
    if ($root -and (Test-Path $root)) {
        $candidates += $root
        Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object { $candidates += (Join-Path $_.FullName "bin") }
    }
}
$candidates = $candidates | Where-Object { $_ } | Select-Object -Unique

$usable = ""
$rows = @()
foreach ($dir in $candidates) {
    $hasDump = Test-Path (Join-Path $dir "pg_dump.exe")
    $hasPsql = Test-Path (Join-Path $dir "psql.exe")
    $hasRestore = Test-Path (Join-Path $dir "pg_restore.exe")
    $rows += [pscustomobject]@{ Folder = $dir; pg_dump = $hasDump; psql = $hasPsql; pg_restore = $hasRestore }
    if ($hasDump -and -not $usable) { $usable = $dir }
}
if ($rows.Count -eq 0) {
    Say "  (no PostgreSQL folder found in the usual places)"
} else {
    $rows | Format-Table -AutoSize | Out-String -Width 200 | ForEach-Object { Say $_ }
}

$pathDump = Get-Command "pg_dump.exe" -ErrorAction SilentlyContinue
if ($pathDump) {
    Say "  pg_dump is also on the PATH: $($pathDump.Source)"
    if (-not $usable) { $usable = Split-Path -Parent $pathDump.Source }
}

# ---------------------------------------------------------------------------
# 4. what to do next
# ---------------------------------------------------------------------------
Head "4) What to do next"
if ($usable) {
    Say "  Found the tools here:"
    Say "    $usable"
    Say ""
    Say "  The backup, the migration pack and the restore already search that place"
    Say "  by themselves after the 2026-10-14 update. If you are still on the older"
    Say "  version, or if a tool is reported missing again, write the folder into"
    Say "  .env so every part of WoodTek ERP uses it:"
    Say "    WOODTEK_PG_BIN=$usable"

    $already = ""
    if (Test-Path $EnvFile) {
        $m = Select-String -Path $EnvFile -Pattern '^\s*WOODTEK_PG_BIN\s*=\s*(.*?)\s*$' | Select-Object -First 1
        if ($m) { $already = $m.Matches[0].Groups[1].Value.Trim() }
    }
    if ($already -and $already -ne $usable) {
        Say ""
        Say "  .env currently says WOODTEK_PG_BIN=$already"
    }
    if ($already -eq $usable) {
        Say ""
        Say "  .env already points at this folder - nothing else to do."
    } else {
        $answer = "no"
        if ($Yes) {
            $answer = "YES"
        } else {
            Say ""
            $answer = Read-Host "  Write this line into .env now? Type YES"
        }
        if ($answer -eq "YES") {
            if (-not (Test-Path $EnvFile)) { New-Item -Path $EnvFile -ItemType File -Force | Out-Null }
            $lines = @()
            if (Test-Path $EnvFile) { $lines = @(Get-Content $EnvFile) }
            $found = $false
            for ($i = 0; $i -lt $lines.Count; $i++) {
                if ($lines[$i] -match '^\s*WOODTEK_PG_BIN\s*=') {
                    $lines[$i] = "WOODTEK_PG_BIN=$usable"
                    $found = $true
                }
            }
            if (-not $found) { $lines += "WOODTEK_PG_BIN=$usable" }
            # WriteAllLines = UTF-8 WITHOUT a byte-order mark, so the first
            # line of .env keeps working for the app's .env reader.
            [System.IO.File]::WriteAllLines($EnvFile, [string[]]$lines)
            Say "  Saved. Restart WoodTek ERP (or re-run the update) so the app picks it up."
        } else {
            Say "  Nothing was changed."
        }
    }
} else {
    Say "  No PostgreSQL command-line tools were found on this PC."
    if ($DbHost -and $DbHost -ne "localhost" -and $DbHost -ne "127.0.0.1") {
        Say ""
        Say "  Your database is on $DbHost, which explains it: this PC only has the"
        Say "  application, not the database tools. Two ways forward:"
        Say "    a) install the PostgreSQL command-line tools on THIS PC"
        Say "       (postgresql.org > Download > Windows > the installer; you may untick"
        Say "        the server and keep 'Command Line Tools'), then run this again;"
        Say "    b) run the migration pack ON $DbHost, or have the dump taken there."
    } else {
        Say ""
        Say "  PostgreSQL seems to be on this PC but its tools were not found."
        Say "  Send these three things to the agent:"
        Say "    1. this window (a photo is fine)"
        Say "    2. the output of:  Get-Service postgresql* | Format-List Name,State,PathName"
        Say "    3. the folder where PostgreSQL was installed when you set this PC up"
    }
}
Say ""
Write-Host "Done. Nothing else was touched." -ForegroundColor Cyan
Say ""
