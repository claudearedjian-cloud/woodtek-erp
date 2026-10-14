# ============================================================================
# WoodTek ERP - copy the newest backups off this PC (copy-backups-offsite.ps1)
# ----------------------------------------------------------------------------
# The nightly backup writes a database dump + a data zip into
# backups\nightly\ EVERY NIGHT on THIS PC. A backup that only exists on the
# machine it protects is not a backup - this helper copies the newest pair to
# a USB stick or another PC (double-click copy-backups-offsite.bat).
#
# It is read-only on the source: nothing here deletes or changes anything in
# backups\nightly\. It also remembers the destination you type (in
# backups\copy-offsite.txt) so every later double-click is one click.
#
# Works with PowerShell 4.0 (Windows Server 2012 R2): no zip cmdlets, no
# writing through the output pipeline.
# ============================================================================

param(
    [string]$BackupRoot = "",
    [string]$Destination = "",
    [switch]$All
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
if (-not $Root) { $Root = (Get-Location).Path }

if (-not $BackupRoot) {
    $BackupRoot = Join-Path $Root "backups\nightly"
    if (-not (Test-Path $BackupRoot)) {
        $fallback = Join-Path $Root "backups"
        if (Test-Path $fallback) { $BackupRoot = $fallback }
    }
}
if (-not (Test-Path $BackupRoot)) {
    Write-Host ""
    Write-Host "No backups folder was found." -ForegroundColor Yellow
    Write-Host "Looked for: $BackupRoot"
    Write-Host "Let the nightly backup run once (01:30), then try again."
    exit 1
}

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  WoodTek ERP - copy the newest backups off this PC" -ForegroundColor Cyan
Write-Host "==================================================================" -ForegroundColor Cyan
Write-Host "  From : $BackupRoot"

# ---------------------------------------------------------------------------
# 1. Which files are we copying? The newest dump + data zip (or all of them).
# ---------------------------------------------------------------------------
$dumps = @()
$dataZips = @()
if ($All) {
    $dumps = @(Get-ChildItem -Path $BackupRoot -Filter "db-*.dump" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
    $dataZips = @(Get-ChildItem -Path $BackupRoot -Filter "data-*.zip" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
} else {
    $dumps = @(Get-ChildItem -Path $BackupRoot -Filter "db-*.dump" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
    $dataZips = @(Get-ChildItem -Path $BackupRoot -Filter "data-*.zip" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
}

if ($dumps.Count -eq 0 -and $dataZips.Count -eq 0) {
    Write-Host ""
    Write-Host "There are no db-*.dump / data-*.zip files in that folder yet." -ForegroundColor Yellow
    Write-Host "The log file next to them (backup-woodtek.log) says why the last run failed."
    Write-Host "Open it, or send a photo of it to the agent."
    exit 1
}

Write-Host ""
Write-Host "  To copy:"
foreach ($f in $dumps) {
    $mb = [math]::Round(($f.Length / 1MB), 1)
    Write-Host ("    {0}  ({1} MB)" -f $f.Name, $mb)
}
foreach ($f in $dataZips) {
    $mb = [math]::Round(($f.Length / 1MB), 1)
    Write-Host ("    {0}  ({1} MB)" -f $f.Name, $mb)
}

# ---------------------------------------------------------------------------
# 2. Where should they go? Remembered destination wins; otherwise ask.
# ---------------------------------------------------------------------------
$rememberFile = Join-Path $Root "backups\copy-offsite.txt"
$remembered = ""
if (Test-Path $rememberFile) {
    $remembered = ([System.IO.File]::ReadAllText($rememberFile)).Trim()
}

$dest = $Destination
if (-not $dest) { $dest = $remembered }

if (-not $dest) {
    Write-Host ""
    Write-Host "Where should the copies go? Type a folder and press Enter." -ForegroundColor White
    Write-Host "  - USB stick      : plug it in, open 'This PC', note its letter" -ForegroundColor Gray
    Write-Host "                     (for example E:), then type:  E:" -ForegroundColor Gray
    Write-Host "  - another PC     : type its shared folder, for example" -ForegroundColor Gray
    Write-Host "                     \\192.168.220.179\WoodTekBackups" -ForegroundColor Gray
    Write-Host ""
    $dest = Read-Host "Destination"
}

if (-not $dest -or $dest.Trim() -eq "") {
    Write-Host ""
    Write-Host "Nothing was typed, so nothing was copied." -ForegroundColor Yellow
    exit 1
}
$dest = $dest.Trim()

# Keep every copy inside one clearly named folder at the destination
# (unless the destination already ends with that name).
$leaf = Split-Path $dest -Leaf
if ($leaf -and ($leaf.ToLower() -eq "woodtek-backups")) {
    $target = $dest
} else {
    $target = Join-Path $dest "WoodTek-Backups"
}

if (-not (Test-Path $target)) {
    try {
        New-Item -Path $target -ItemType Directory -Force | Out-Null
    } catch {
        Write-Host ""
        Write-Host "That destination is not available:" -ForegroundColor Red
        Write-Host "  $target"
        Write-Host "  ($($_.Exception.Message))"
        Write-Host "Is the USB stick plugged in? Is the other PC switched on?"
        exit 1
    }
}
Write-Host ""
Write-Host "  To   : $target" -ForegroundColor White

# ---------------------------------------------------------------------------
# 3. Copy, then PROVE it: sizes must match at both ends.
# ---------------------------------------------------------------------------
$files = @()
foreach ($f in $dumps) { $files += $f }
foreach ($f in $dataZips) { $files += $f }

$failures = 0
$okCount = 0
$copiedNames = @()
$copiedMb = 0

Write-Host ""
foreach ($f in $files) {
    $to = Join-Path $target $f.Name
    $mb = [math]::Round(($f.Length / 1MB), 1)
    try {
        Copy-Item -Path $f.FullName -Destination $to -Force
        $check = Get-Item -Path $to -ErrorAction Stop
        if ($check.Length -eq $f.Length) {
            Write-Host ("  OK      {0}  ({1} MB)" -f $f.Name, $mb) -ForegroundColor Green
            $okCount += 1
            $copiedNames += $f.Name
            $copiedMb += $mb
        } else {
            Write-Host ("  FAILED  {0} - copied size does not match" -f $f.Name) -ForegroundColor Red
            $failures += 1
        }
    } catch {
        Write-Host ("  FAILED  {0} - {1}" -f $f.Name, $_.Exception.Message) -ForegroundColor Red
        $failures += 1
    }
}

# ---------------------------------------------------------------------------
# 4. A small log line, so "when did we last do this?" has an answer.
# ---------------------------------------------------------------------------
$logFile = Join-Path $Root "backups\copy-offsite.log"
$stamp = Get-Date -Format "yyyy-MM-dd HH:mm"
$result = "OK"
if ($failures -gt 0) { $result = "FAILED (" + $failures + ")" }
$logLine = $stamp + "  " + $result + "  to " + $target + "  files: " + ($copiedNames -join ", ") + "  total " + $copiedMb + " MB"
try {
    Add-Content -Path $logFile -Value $logLine
} catch { }

# ---------------------------------------------------------------------------
# 5. Offer to remember the destination so the next time is one double-click.
# ---------------------------------------------------------------------------
if ((-not $Destination) -and ($dest -ne $remembered)) {
    Write-Host ""
    $answer = Read-Host "Remember this destination for next time? Type YES"
    if ($answer -eq "YES") {
        try {
            [System.IO.File]::WriteAllText($rememberFile, $dest)
            Write-Host "  Saved - next time the copy goes to the same place with no questions." -ForegroundColor Green
        } catch {
            Write-Host "  Could not save the destination ($($_.Exception.Message))." -ForegroundColor Yellow
        }
    }
}

Write-Host ""
if ($failures -eq 0) {
    Write-Host "Done - $okCount file(s), $copiedMb MB copied to:" -ForegroundColor Green
    Write-Host "  $target" -ForegroundColor Green
    Write-Host "The originals stay in $BackupRoot untouched."
} else {
    Write-Host "Finished with $failures failure(s) - the lines above say which file." -ForegroundColor Yellow
    Write-Host "Try again, or send a photo of this window to the agent."
    exit 1
}
exit 0
