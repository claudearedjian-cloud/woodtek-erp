# ============================================================================
# WoodTek ERP — Quick Edition / Module Pack Configurator (configure-edition.ps1)
# ----------------------------------------------------------------------------
# Updates data\installed-edition.json and data\optional-modules.json on an
# already-installed PC without re-extracting the full application archive.
#
# Examples:
#   # Install all modules (Full ERP):
#   powershell -ExecutionPolicy Bypass -File installer\configure-edition.ps1 -Addons "all"
#
#   # Install Core Production + CMMS only:
#   powershell -ExecutionPolicy Bypass -File installer\configure-edition.ps1 -Addons "cmms"
#
#   # Install Core Production + Invoicing & Money + Purchasing:
#   powershell -ExecutionPolicy Bypass -File installer\configure-edition.ps1 -Addons "invoicing,purchasing"
#
#   # Core Production & Stock only (no add-ons):
#   powershell -ExecutionPolicy Bypass -File installer\configure-edition.ps1 -Addons "none"
# ============================================================================

param(
    [string]$Addons = "invoicing,purchasing,cmms,workforce",
    [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"
$Root = if ($InstallDir) { $InstallDir } else { Split-Path -Parent $PSScriptRoot }

$bundledNode = Join-Path $Root "runtime\node\node.exe"
$nodeExe = if (Test-Path $bundledNode) { $bundledNode } else { "node" }

& $nodeExe (Join-Path $Root "installer\bootstrap-db.cjs") --config-only --addons="$Addons" --data-dir="$(Join-Path $Root 'data')"
if ($LASTEXITCODE -ne 0) {
    throw "Failed to update installed edition."
}
Write-Host "Installed edition updated successfully in $(Join-Path $Root 'data\installed-edition.json')." -ForegroundColor Green
