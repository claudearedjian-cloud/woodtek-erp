param(
    [string]$DumpPath = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Windows.Forms

if (-not $DumpPath) {
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = "Choose the pre-update WoodTek database dump"
    $dialog.Filter = "PostgreSQL database dumps (*.dump)|*.dump|All files (*.*)|*.*"
    $dialog.Multiselect = $false
    $dialog.CheckFileExists = $true
    $preferredFolder = "\\192.168.220.205\c$\WoodTek-ERP\backups\update-20261109-f3ea6ca-20261109-100915"
    if (Test-Path $preferredFolder) {
        $dialog.InitialDirectory = $preferredFolder
    } elseif ($env:USERPROFILE -and (Test-Path (Join-Path $env:USERPROFILE "Desktop"))) {
        $dialog.InitialDirectory = Join-Path $env:USERPROFILE "Desktop"
    }

    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
        Write-Host "Inspection cancelled. No files or databases were changed."
        exit 0
    }
    $DumpPath = $dialog.FileName
}

if (-not (Test-Path -LiteralPath $DumpPath -PathType Leaf)) {
    throw "The selected dump file was not found. Nothing was changed."
}

$root = Split-Path -Parent $PSScriptRoot
$inspector = Join-Path $root "scripts\inspect-db-dump.cjs"
$node = Get-Command "node.exe" -ErrorAction SilentlyContinue
if (-not $node) {
    $portableNode = Join-Path $root "runtime\node\node.exe"
    if (Test-Path $portableNode) {
        $nodePath = $portableNode
    } else {
        throw "Node.js was not found on the old PC. Nothing was changed."
    }
} else {
    $nodePath = $node.Source
}

Write-Host "Selected dump: $DumpPath"
Write-Host "The checker only streams rows from pg_restore; it does not restore or connect to any database."
& $nodePath $inspector $DumpPath
if ($LASTEXITCODE -ne 0) {
    throw "The read-only dump inspection did not complete successfully."
}
