# ============================================================================
# WoodTek ERP - Turnkey Windows Installation Engine (install-engine.ps1)
# ----------------------------------------------------------------------------
# Invoked by WoodTek-ERP-Setup.exe (or directly from PowerShell for silent
# deployment). Performs a complete turnkey setup on a brand-new or existing PC:
#   1. Stops any existing WoodTek ERP task on the target port
#   2. Extracts the standalone application payload (preserving .env & data\)
#   3. Verifies the Node.js runtime actually starts on THIS Windows (on
#      Windows 8.1 / Server 2012 R2, where Node.js 23+ refuses to run, it
#      installs Node.js 22 LTS - the newest line that supports them - from
#      prereqs\node-win-x64.zip or nodejs.org; node.exe is never trusted
#      blindly again)
#   4. Verifies local PostgreSQL service (or silently installs PostgreSQL 16)
#   5. Generates .env (AUTH_SECRET + DATABASE_URL), creates database & 31
#      tables, and writes data\installed-edition.json (hard-locked modules)
#   6. Opens Windows Firewall, registers "\WoodTek ERP" & "\WoodTek Nightly
#      Backup" scheduled tasks, and creates Desktop/Start Menu shortcuts
#   7. Starts the server and waits for /api/health -> 200 OK
# ============================================================================

param(
    [string]$InstallDir = "C:\WoodTek-ERP",
    [string]$Addons = "invoicing,purchasing,cmms,workforce",
    [int]$Port = 3000,
    [string]$PgSuperPassword = "postgres",
    [string]$DbUrl = "",
    [string]$ManagerName = "Claude Aredjian",
    [string]$ManagerPin = "1234",
    [string]$PayloadZip = ""
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Write-Step([string]$msg) {
    Write-Host "[STEP] $msg"
    [Console]::Out.Flush()
}

function Write-Info([string]$msg) {
    Write-Host "  -> $msg"
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

# ----------------------------------------------------------------------------
# Step 1: Stop existing service if running
# ----------------------------------------------------------------------------
Write-Step "Step 1/7: Preparing installation directory ($InstallDir)..."
try {
    schtasks /End /TN "\WoodTek ERP" 2>$null | Out-Null
} catch {}

if (Test-TcpPort "127.0.0.1" $Port) {
    Write-Info "Stopping existing listener on TCP port $Port..."
    try {
        $netstat = netstat -ano | Select-String ":$Port\s+.*LISTENING\s+(\d+)$"
        foreach ($m in $netstat) {
            if ($m.Matches.Count -gt 0) {
                $pidToKill = $m.Matches[0].Groups[1].Value
                if ($pidToKill -and $pidToKill -ne "0") {
                    taskkill /F /T /PID $pidToKill 2>$null | Out-Null
                }
            }
        }
    } catch {}
    Start-Sleep -Seconds 2
}

if (!(Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# ----------------------------------------------------------------------------
# Step 2: Extract application payload (if PayloadZip supplied)
# ----------------------------------------------------------------------------
Write-Step "Step 2/7: Installing WoodTek ERP standalone application files..."
if ($PayloadZip -and (Test-Path $PayloadZip)) {
    $stageExtract = Join-Path $env:TEMP ("woodtek-extract-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $stageExtract -Force | Out-Null
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [System.IO.Compression.ZipFile]::ExtractToDirectory($PayloadZip, $stageExtract)

        # Replace .next\standalone cleanly so no stale chunks remain
        $targetStandalone = Join-Path $InstallDir ".next\standalone"
        if (Test-Path $targetStandalone) {
            Remove-Item -Path $targetStandalone -Recurse -Force -ErrorAction SilentlyContinue
        }

        Copy-Item -Path (Join-Path $stageExtract "*") -Destination $InstallDir -Recurse -Force
        Write-Info "Application files extracted to $InstallDir."
    } finally {
        Remove-Item -Path $stageExtract -Recurse -Force -ErrorAction SilentlyContinue
    }
} else {
    Write-Info "Using existing files in $InstallDir."
}

foreach ($sub in @("data", "logs", "backups", "backups\nightly")) {
    $p = Join-Path $InstallDir $sub
    if (!(Test-Path $p)) {
        New-Item -ItemType Directory -Path $p -Force | Out-Null
    }
}

# ----------------------------------------------------------------------------
# Step 3: Verify or install the Node.js runtime
# ----------------------------------------------------------------------------
# Node.js 23 and newer refuse to start on Windows 8.1 / Server 2012 R2 and
# older ("Node.js is only supported on Windows 10, Windows Server 2016, or
# higher") and exit before running anything. The turnkey install copies this
# PC's own runtime into the payload, so on such a server the install used to
# stop at the database bootstrap with only that warning on screen. This step
# now:
#   1. probes every candidate runtime by actually running "node --version";
#   2. on an old Windows installs Node.js 22 LTS - the newest line that
#      officially supports 8.1 / Server 2012 R2 and still satisfies the app
#      (Next.js needs >= 20.9; CI runs Node 22) - from
#      installer\prereqs\node-win-x64.zip when the payload carries it,
#      downloading it from nodejs.org otherwise;
#   3. only when that is impossible falls back to Node.js' own documented
#      escape hatch (NODE_SKIP_PLATFORM_CHECK=1), which the start scripts set
#      for those Windows versions too;
#   4. refuses to continue, with a readable message, instead of failing later
#      inside a database call.
# One runtime (Node.js 22 LTS) covers both the current Windows 10/11 PCs and an
# older server, so nothing here changes on a supported Windows version.
Write-Step "Step 3/7: Checking Node.js runtime..."

$legacyNodeVersion = "v22.23.3"
$bundledNode = Join-Path $InstallDir "runtime\node\node.exe"
$systemNode = "C:\Program Files\nodejs\node.exe"

function Get-WindowsMajorVersion {
    # CurrentMajorVersionNumber exists on Windows 10 / Server 2016 and newer
    # only; older versions (and anything unreadable) report 6.
    try {
        $value = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" `
            -Name CurrentMajorVersionNumber -ErrorAction Stop).CurrentMajorVersionNumber
        if ($value) { return [int]$value }
    } catch { }
    return 6
}

function Test-NodeRuntime([string]$Exe) {
    if (-not $Exe) { return $false }
    if (-not (Test-Path $Exe)) { return $false }
    try {
        $version = & $Exe "--version" 2>$null
        if ($LASTEXITCODE -ne 0) { return $false }
        return ("$version" -match "^v\d+")
    } catch {
        return $false
    }
}

function Install-PortableNode([string]$Version, [string]$TargetDir) {
    # Uses the zip that travels inside the installer when it is there, so an
    # offline PC works; downloads the official build otherwise.
    $zipFile = Join-Path $env:TEMP "node-$Version-win-x64.zip"
    $cachedZip = Join-Path $InstallDir "prereqs\node-win-x64.zip"
    $extractDir = Join-Path $env:TEMP ("node-extract-" + [Guid]::NewGuid().ToString("N"))

    if (Test-Path $cachedZip) {
        Copy-Item -Path $cachedZip -Destination $zipFile -Force
        Write-Info "Using the Node.js runtime that came with the installer."
    } else {
        Write-Info "Downloading Node.js $Version (Windows x64) from nodejs.org..."
        Invoke-WebRequest -Uri "https://nodejs.org/dist/$Version/node-$Version-win-x64.zip" `
            -OutFile $zipFile -UseBasicParsing
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipFile, $extractDir)
    $inner = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
    $source = if ($inner) { $inner.FullName } else { $extractDir }
    New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    Copy-Item -Path (Join-Path $source "*") -Destination $TargetDir -Recurse -Force
    Remove-Item -Path $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    if (-not (Test-Path $cachedZip)) {
        Remove-Item -Path $zipFile -Force -ErrorAction SilentlyContinue
    }
}

$windowsMajor = Get-WindowsMajorVersion
$legacyWindows = ($windowsMajor -lt 10)
if ($legacyWindows) {
    Write-Info "Windows major version $windowsMajor detected (Windows 8.1 / Server 2012 R2 or older)."
} else {
    Write-Info "Windows 10 / Server 2016 or newer detected."
}

# Candidates in order of preference: the runtime shipped with the app, the
# machine-wide Node.js, then whatever PATH offers.
$candidates = @()
if (Test-Path $bundledNode) { $candidates += $bundledNode }
if (Test-Path $systemNode) { $candidates += $systemNode }
$pathNode = Get-Command node -ErrorAction SilentlyContinue
if ($pathNode -and $pathNode.Source) { $candidates += $pathNode.Source }

$nodeExe = $null
foreach ($candidate in $candidates) {
    if (Test-NodeRuntime $candidate) {
        $nodeExe = $candidate
        break
    }
    Write-Info "Node.js at $candidate did not start on this Windows version."
}

if (-not $nodeExe -and $legacyWindows) {
    try {
        Install-PortableNode -Version $legacyNodeVersion -TargetDir (Join-Path $InstallDir "runtime\node")
        if (Test-NodeRuntime $bundledNode) {
            $nodeExe = $bundledNode
            Write-Info "Portable Node.js $legacyNodeVersion installed at $nodeExe."
        }
    } catch {
        Write-Info "Warning: portable Node.js could not be installed ($($_.Exception.Message))."
    }
}

if (-not $nodeExe -and $legacyWindows) {
    # Last resort, exactly what Node.js suggests in its own message.
    $env:NODE_SKIP_PLATFORM_CHECK = "1"
    foreach ($candidate in $candidates) {
        if (Test-NodeRuntime $candidate) {
            $nodeExe = $candidate
            break
        }
    }
    if ($nodeExe) {
        Write-Info "Using $nodeExe with NODE_SKIP_PLATFORM_CHECK=1 (this Windows version is older than Node.js officially supports)."
    }
}

if (-not $nodeExe) {
    throw ("No Node.js runtime could start on this PC. Install Node.js 22 LTS from " +
           "https://nodejs.org/dist/latest-v22.x/ and run this installer again, or use a PC " +
           "running Windows 10 / Windows Server 2016 or newer.")
}

Write-Info "Node.js runtime: $nodeExe"
$env:PATH = "$(Split-Path $nodeExe -Parent);$env:PATH"

# ----------------------------------------------------------------------------
# Step 4: Verify or install PostgreSQL Database Server
# ----------------------------------------------------------------------------
Write-Step "Step 4/7: Checking PostgreSQL database server..."
$pgHost = "127.0.0.1"
$pgPort = 5432

if ($DbUrl) {
    try {
        $u = [Uri]$DbUrl
        if ($u.Host) { $pgHost = $u.Host }
        if ($u.Port -gt 0) { $pgPort = $u.Port }
    } catch {}
} else {
    $escapedPwd = [Uri]::EscapeDataString($PgSuperPassword)
    $DbUrl = "postgresql://postgres:$escapedPwd@localhost:5432/woodtek_erp"
}

$isLocalPg = ($pgHost -eq "localhost" -or $pgHost -eq "127.0.0.1")

if (-not (Test-TcpPort $pgHost $pgPort)) {
    if ($isLocalPg) {
        $pgServices = Get-Service -Name "postgresql*" -ErrorAction SilentlyContinue
        if ($pgServices) {
            foreach ($svc in $pgServices) {
                Write-Info "Starting existing PostgreSQL service ($($svc.Name))..."
                Start-Service -Name $svc.Name -ErrorAction SilentlyContinue
            }
            Start-Sleep -Seconds 4
        }
    }
}

if ((-not (Test-TcpPort $pgHost $pgPort)) -and $isLocalPg) {
    Write-Info "PostgreSQL is not installed on this PC. Preparing unattended PostgreSQL 16 installation..."
    $bundledPgSetup = Join-Path $InstallDir "prereqs\postgresql-setup.exe"
    $pgSetupExe = $null

    if (Test-Path $bundledPgSetup) {
        $pgSetupExe = $bundledPgSetup
        Write-Info "Using bundled PostgreSQL installer: $pgSetupExe"
    } else {
        $pgSetupExe = Join-Path $env:TEMP "postgresql-16-windows-x64.exe"
        $pgDownloadUrl = "https://get.enterprisedb.com/postgresql/postgresql-16.6-1-windows-x64.exe"
        Write-Info "Downloading official PostgreSQL 16 installer..."
        Invoke-WebRequest -Uri $pgDownloadUrl -OutFile $pgSetupExe -UseBasicParsing
    }

    Write-Info "Running silent PostgreSQL installation (this takes 1-3 minutes)..."
    $pgArgs = @(
        "--mode", "unattended",
        "--unattendedmodeui", "none",
        "--superpassword", $PgSuperPassword,
        "--servicename", "postgresql-x64-16",
        "--serverport", "$pgPort"
    )
    $proc = Start-Process -FilePath $pgSetupExe -ArgumentList $pgArgs -Wait -PassThru
    if ($proc.ExitCode -ne 0) {
        throw "PostgreSQL installer exited with code $($proc.ExitCode)."
    }

    $waited = 0
    while ((-not (Test-TcpPort "127.0.0.1" $pgPort)) -and ($waited -lt 60)) {
        Start-Sleep -Seconds 2
        $waited += 2
    }
    if (-not (Test-TcpPort "127.0.0.1" $pgPort)) {
        throw "PostgreSQL installation finished, but port $pgPort is still not responding."
    }
    Write-Info "PostgreSQL server is up and listening on port $pgPort."
} elseif (Test-TcpPort $pgHost $pgPort) {
    Write-Info "PostgreSQL is reachable at ${pgHost}:${pgPort}."
} else {
    throw "Cannot reach PostgreSQL at ${pgHost}:${pgPort}. Verify the database server is running."
}

# ----------------------------------------------------------------------------
# Step 5: Configure .env, Database Schema & Hard-Locked Module Edition
# ----------------------------------------------------------------------------
Write-Step "Step 5/7: Configuring environment, database tables & selected modules..."
$envFile = Join-Path $InstallDir ".env"
if (!(Test-Path $envFile)) {
    $rng = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($rng)
    $authSecret = [Convert]::ToBase64String($rng)
    $envContent = @(
        "# WoodTek ERP - Generated by WoodTek-ERP-Setup.exe",
        "DATABASE_URL=$DbUrl",
        "AUTH_SECRET=$authSecret",
        "AUTH_COOKIE_SECURE=false",
        "PORT=$Port",
        "HOSTNAME=0.0.0.0"
    ) -join "`r`n"
    [System.IO.File]::WriteAllText($envFile, $envContent + "`r`n", [System.Text.Encoding]::UTF8)
    Write-Info "Created new .env configuration with cryptographic AUTH_SECRET."
} else {
    Write-Info "Existing .env found - preserving existing configuration."
    # Read DATABASE_URL from existing .env if user did not override
    $lines = Get-Content $envFile
    foreach ($line in $lines) {
        if ($line -match "^\s*DATABASE_URL\s*=\s*(.+)$") {
            $existingUrl = $Matches[1].Trim().Trim('"').Trim("'")
            if ($existingUrl) { $DbUrl = $existingUrl }
        }
    }
}

$bootstrapScript = Join-Path $InstallDir "installer\bootstrap-db.cjs"
$bootstrapArgs = @(
    $bootstrapScript,
    "--addons=$Addons",
    "--db-url=$DbUrl",
    "--data-dir=$(Join-Path $InstallDir 'data')",
    "--manager-name=$ManagerName",
    "--manager-pin=$ManagerPin"
)
& $nodeExe @bootstrapArgs
if ($LASTEXITCODE -ne 0) {
    throw "Database & edition bootstrap failed (exit code $LASTEXITCODE)."
}

# ----------------------------------------------------------------------------
# Step 6: Firewall, Scheduled Tasks & Desktop/Start Menu Shortcuts
# ----------------------------------------------------------------------------
Write-Step "Step 6/7: Registering Windows service task, firewall rule & shortcuts..."
try {
    netsh advfirewall firewall delete rule name="WoodTek ERP Server" 2>$null | Out-Null
    netsh advfirewall firewall add rule name="WoodTek ERP Server" dir=in action=allow protocol=TCP localport=$Port | Out-Null
    Write-Info "Windows Firewall opened for TCP port $Port."
} catch {
    Write-Info "Warning: Could not update Windows Firewall rule ($($_.Exception.Message))."
}

$silentBat = Join-Path $InstallDir "start-woodtek-prod-silent.bat"
if (Test-Path $silentBat) {
    try {
        schtasks /Create /F /TN "\WoodTek ERP" /SC ONSTART /RU SYSTEM /RL HIGHEST /TR "`"$silentBat`"" | Out-Null
        Write-Info "Registered Windows Scheduled Task '\WoodTek ERP' (starts automatically at boot)."
    } catch {
        Write-Info "Warning: Could not register '\WoodTek ERP' scheduled task."
    }
}

$backupPs1 = Join-Path $InstallDir "backup\backup-woodtek.ps1"
if (Test-Path $backupPs1) {
    try {
        $backupCmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$backupPs1`""
        schtasks /Create /F /TN "WoodTek Nightly Backup" /SC DAILY /ST 01:30 /RU SYSTEM /RL HIGHEST /TR $backupCmd | Out-Null
        Write-Info "Registered nightly backup task 'WoodTek Nightly Backup' (01:30 daily)."
    } catch {}
}

try {
    $wsh = New-Object -ComObject WScript.Shell
    $desktopDir = [Environment]::GetFolderPath("CommonDesktopDirectory")
    if (-not $desktopDir -or -not (Test-Path $desktopDir)) {
        $desktopDir = [Environment]::GetFolderPath("Desktop")
    }
    $shortcutPath = Join-Path $desktopDir "WoodTek ERP.lnk"
    $sc = $wsh.CreateShortcut($shortcutPath)
    $sc.TargetPath = "http://localhost:$Port"
    $sc.Description = "Open WoodTek ERP"
    $sc.Save()

    $startMenuDir = Join-Path ([Environment]::GetFolderPath("CommonPrograms")) "WoodTek ERP"
    if (!(Test-Path $startMenuDir)) {
        New-Item -ItemType Directory -Path $startMenuDir -Force | Out-Null
    }
    $smOpen = $wsh.CreateShortcut((Join-Path $startMenuDir "WoodTek ERP.lnk"))
    $smOpen.TargetPath = "http://localhost:$Port"
    $smOpen.Description = "Open WoodTek ERP in Browser"
    $smOpen.Save()

    $interactiveBat = Join-Path $InstallDir "start-woodtek-prod.bat"
    if (Test-Path $interactiveBat) {
        $smServer = $wsh.CreateShortcut((Join-Path $startMenuDir "Start WoodTek Server.lnk"))
        $smServer.TargetPath = $interactiveBat
        $smServer.WorkingDirectory = $InstallDir
        $smServer.Description = "Start WoodTek ERP Production Server"
        $smServer.Save()
    }
    Write-Info "Created Desktop and Start Menu shortcuts."
} catch {
    Write-Info "Warning: Shortcut creation skipped ($($_.Exception.Message))."
}

# ----------------------------------------------------------------------------
# Step 7: Start Server & Verify /api/health
# ----------------------------------------------------------------------------
Write-Step "Step 7/7: Starting WoodTek ERP server and verifying health..."
try {
    schtasks /Run /TN "\WoodTek ERP" | Out-Null
} catch {
    Start-Process -FilePath $nodeExe -ArgumentList "`"$(Join-Path $InstallDir 'start-prod.cjs')`" --no-browser" -WorkingDirectory $InstallDir -WindowStyle Hidden
}

$healthy = $false
$elapsed = 0
while ((-not $healthy) -and ($elapsed -lt 30)) {
    Start-Sleep -Seconds 2
    $elapsed += 2
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health" -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        if ($resp.StatusCode -eq 200) {
            $healthy = $true
        }
    } catch {}
}

if ($healthy) {
    Write-Info "WoodTek ERP is running and healthy at http://localhost:$Port"
} else {
    Write-Info "Server started in background (check $InstallDir\logs\woodtek.log if needed)."
}

Write-Host "[COMPLETE] WoodTek ERP installation finished successfully."
