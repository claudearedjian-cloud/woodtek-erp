[CmdletBinding()]
param(
    [string]$ProjectRoot = "C:\woodtek-erp",
    [ValidateRange(1024, 65535)]
    [int]$Port = 3000,
    [switch]$SkipDatabaseCheck,
    [switch]$SkipSchemaPush,
    [switch]$CleanNext,
    [switch]$InstallDependencies,
    [switch]$OpenBrowser
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step {
    param(
        [int]$Number,
        [int]$Total,
        [string]$Message
    )

    Write-Host ""
    Write-Host "[$Number/$Total] $Message" `
        -ForegroundColor Yellow
}

function Stop-ProcessOnPort {
    param(
        [int]$TargetPort
    )

    $Connections = Get-NetTCPConnection `
        -LocalPort $TargetPort `
        -State Listen `
        -ErrorAction SilentlyContinue

    if (-not $Connections) {
        return
    }

    $ProcessIds = $Connections |
        Select-Object `
            -ExpandProperty OwningProcess `
            -Unique

    foreach ($ProcessId in $ProcessIds) {
        if ($ProcessId -eq $PID) {
            continue
        }

        $Process = Get-Process `
            -Id $ProcessId `
            -ErrorAction SilentlyContinue

        if ($Process) {
            Write-Host `
                "Stopping process $($Process.ProcessName) (PID $ProcessId) on port $TargetPort..." `
                -ForegroundColor DarkYellow

            Stop-Process `
                -Id $ProcessId `
                -Force
        }
    }
}

function Get-EnvironmentValue {
    param(
        [Parameter(Mandatory = $true)]
        [string]$EnvironmentFile,

        [Parameter(Mandatory = $true)]
        [string]$Key
    )

    $Line = Get-Content $EnvironmentFile |
        Where-Object {
            $_ -match "^\s*$([regex]::Escape($Key))\s*="
        } |
        Select-Object -First 1

    if (-not $Line) {
        return $null
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

    return $Value
}

function Assert-CommandExists {
    param(
        [Parameter(Mandatory = $true)]
        [string]$CommandName
    )

    if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
        throw "$CommandName was not found in PATH."
    }
}

$TotalSteps = 9

Write-Host ""
Write-Host "WoodTek ERP Development Startup" `
    -ForegroundColor Cyan

Write-Host "===============================" `
    -ForegroundColor Cyan

Write-Host "Project: $ProjectRoot"
Write-Host "Port   : $Port"

# ---------------------------------------------------------------------------
# Step 1 — Validate project
# ---------------------------------------------------------------------------

Write-Step `
    -Number 1 `
    -Total $TotalSteps `
    -Message "Validating project folder"

if (-not (Test-Path $ProjectRoot)) {
    throw "Project folder was not found: $ProjectRoot"
}

$ProjectRoot = (
    Resolve-Path $ProjectRoot
).Path

Set-Location $ProjectRoot

$RequiredFiles = @(
    "package.json"
    "src\app\page.tsx"
    "src\db\schema.ts"
    "src\app\api\bootstrap\route.ts"
)

foreach ($RelativePath in $RequiredFiles) {
    $FullPath = Join-Path `
        $ProjectRoot `
        $RelativePath

    if (-not (Test-Path $FullPath)) {
        throw "Required file is missing: $RelativePath"
    }
}

# ---------------------------------------------------------------------------
# Step 2 — Validate Node/npm
# ---------------------------------------------------------------------------

Write-Step `
    -Number 2 `
    -Total $TotalSteps `
    -Message "Checking Node.js and npm"

Assert-CommandExists `
    -CommandName "node"

Assert-CommandExists `
    -CommandName "npm"

$NodeVersion = (
    node --version
).Trim()

$NpmVersion = (
    npm --version
).Trim()

Write-Host "Node: $NodeVersion"
Write-Host "npm : $NpmVersion"

$NodeMajor = [int](
    $NodeVersion `
        -replace "^v", "" `
        -split "\."
)[0]

if ($NodeMajor -lt 20) {
    throw "Node.js 20 or newer is required."
}

if ($NodeMajor -gt 22) {
    Write-Warning @"
Node.js $NodeVersion is not the recommended LTS version.

Use Node.js 20 LTS or 22 LTS if Next.js behaves unexpectedly.
"@
}

# ---------------------------------------------------------------------------
# Step 3 — Check .env
# ---------------------------------------------------------------------------

Write-Step `
    -Number 3 `
    -Total $TotalSteps `
    -Message "Checking environment configuration"

$EnvironmentFile = Join-Path `
    $ProjectRoot `
    ".env"

if (-not (Test-Path $EnvironmentFile)) {
    $ExampleFile = Join-Path `
        $ProjectRoot `
        ".env.example"

    if (Test-Path $ExampleFile) {
        Copy-Item `
            $ExampleFile `
            $EnvironmentFile

        Write-Warning @"
.env was missing.

A new .env was copied from .env.example.
Edit it now, then rerun this script.
"@
    }

    throw ".env is missing or requires configuration."
}

$DatabaseUrl = Get-EnvironmentValue `
    -EnvironmentFile $EnvironmentFile `
    -Key "DATABASE_URL"

if (-not $DatabaseUrl) {
    throw "DATABASE_URL is missing from .env."
}

$AuthSecret = Get-EnvironmentValue `
    -EnvironmentFile $EnvironmentFile `
    -Key "AUTH_SECRET"

if (-not $AuthSecret) {
    Write-Warning @"
AUTH_SECRET is missing.

The development server may use a temporary in-memory secret.
Sessions will not survive a restart.

Generate a permanent value before production deployment.
"@
}
elseif ($AuthSecret.Length -lt 16) {
    Write-Warning "AUTH_SECRET is unusually short."
}

# Remove inherited variables that can affect Next.js.
Remove-Item `
    Env:NODE_ENV `
    -ErrorAction SilentlyContinue

Remove-Item `
    Env:NODE_OPTIONS `
    -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# Step 4 — Stop previous process
# ---------------------------------------------------------------------------

Write-Step `
    -Number 4 `
    -Total $TotalSteps `
    -Message "Releasing port $Port"

Stop-ProcessOnPort `
    -TargetPort $Port

# ---------------------------------------------------------------------------
# Step 5 — Dependencies
# ---------------------------------------------------------------------------

Write-Step `
    -Number 5 `
    -Total $TotalSteps `
    -Message "Checking dependencies"

$NodeModules = Join-Path `
    $ProjectRoot `
    "node_modules"

if (
    $InstallDependencies -or
    -not (Test-Path $NodeModules)
) {
    if (Test-Path "package-lock.json") {
        Write-Host "Installing dependencies with npm ci..."
        npm ci
    }
    else {
        Write-Host "Installing dependencies with npm install..."
        npm install
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Dependency installation failed."
    }
}
else {
    Write-Host "node_modules exists. Dependency installation skipped."
}

# ---------------------------------------------------------------------------
# Step 6 — Database check
# ---------------------------------------------------------------------------

Write-Step `
    -Number 6 `
    -Total $TotalSteps `
    -Message "Checking database connectivity"

if ($SkipDatabaseCheck) {
    Write-Host "Database check skipped." `
        -ForegroundColor DarkYellow
}
else {
    # Use Drizzle's config loading as the connection check.
    npx drizzle-kit introspect `
        --config=drizzle.config.ts `
        --out=.drizzle-health-temp

    $DrizzleStatus = $LASTEXITCODE

    Remove-Item `
        -LiteralPath ".drizzle-health-temp" `
        -Recurse `
        -Force `
        -ErrorAction SilentlyContinue

    if ($DrizzleStatus -ne 0) {
        throw @"
Database connection failed.

Verify:
- PostgreSQL service is running
- DATABASE_URL in .env
- Database password
- Database name
"@
    }
}

# ---------------------------------------------------------------------------
# Step 7 — Push schema
# ---------------------------------------------------------------------------

Write-Step `
    -Number 7 `
    -Total $TotalSteps `
    -Message "Applying Drizzle schema"

if ($SkipSchemaPush) {
    Write-Host "Schema push skipped." `
        -ForegroundColor DarkYellow
}
else {
    npx drizzle-kit push `
        --config=drizzle.config.ts

    if ($LASTEXITCODE -ne 0) {
        throw "Drizzle schema push failed."
    }
}

# ---------------------------------------------------------------------------
# Step 8 — Clean cache and type generation
# ---------------------------------------------------------------------------

Write-Step `
    -Number 8 `
    -Total $TotalSteps `
    -Message "Preparing Next.js development cache"

if ($CleanNext) {
    Remove-Item `
        -LiteralPath ".next" `
        -Recurse `
        -Force `
        -ErrorAction SilentlyContinue

    Write-Host ".next cache removed."
}

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

# ---------------------------------------------------------------------------
# Step 9 — Start development server
# ---------------------------------------------------------------------------

Write-Step `
    -Number 9 `
    -Total $TotalSteps `
    -Message "Starting WoodTek ERP development server"

$LocalUrl = "http://127.0.0.1:$Port"
$HealthUrl = "$LocalUrl/api/health"
$BootstrapUrl = "$LocalUrl/api/bootstrap"

Write-Host ""
Write-Host "Local application:" `
    -ForegroundColor Green

Write-Host $LocalUrl `
    -ForegroundColor Cyan

Write-Host ""
Write-Host "Health check:"
Write-Host $HealthUrl

Write-Host ""
Write-Host "First-run setup status:"
Write-Host $BootstrapUrl

Write-Host ""

if ($OpenBrowser) {
    Start-Process $LocalUrl
}

# This is intentionally the final foreground process.
# Press Ctrl+C to stop it.
npx next dev `
    --port $Port