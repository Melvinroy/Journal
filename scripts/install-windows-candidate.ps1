# Per-user installation of an already obtained, reviewed candidate directory.
# This script does not download files, change execution policy, or elevate.
param(
    [string]$PackageRoot = $PSScriptRoot,
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs/Brontide'),
    [switch]$NoShortcut
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows is required.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this per-user installer from a normal, non-elevated PowerShell window.'
}

$packageItem = Get-Item -LiteralPath $PackageRoot -Force
if ($packageItem.Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'Package root must not be a reparse point.'
}
$source = (Resolve-Path -LiteralPath $PackageRoot).Path
$manifestPath = Join-Path $source 'manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schema -ne 1 -or $manifest.platform -ne 'windows-x64' -or
    $manifest.brokerExecution -ne 'disabled' -or $manifest.signed -ne $false) {
    throw 'This installer accepts only the locked, unsigned Windows candidate manifest.'
}
if ($manifest.source -notmatch '^[0-9a-f]{40}$' -or $manifest.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$') {
    throw 'Invalid candidate identity.'
}

function Assert-PackageFiles([string]$folder, $entries) {
    if ((Get-Item -LiteralPath $folder -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Package root must not be a reparse point.'
    }
    $expected = @($entries | ForEach-Object { [string]$_.path })
    $items = @(Get-ChildItem -LiteralPath $folder -Recurse -Force)
    foreach ($item in $items) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Package contains a reparse point: $($item.FullName)"
        }
    }
    $actualFiles = @($items | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
        [System.IO.Path]::GetRelativePath($folder, $_.FullName).Replace('\', '/')
    } | Where-Object { $_ -ne 'manifest.json' })
    if (@(Compare-Object -ReferenceObject $expected -DifferenceObject $actualFiles).Count -ne 0) {
        throw 'Package contains missing or unlisted files.'
    }
    foreach ($entry in $entries) {
        $relative = [string]$entry.path
        if (-not $relative -or $relative.StartsWith('/') -or $relative.Contains('..') -or
            $relative.Contains(':') -or $relative.Contains('\')) {
            throw "Unsafe package path: $relative"
        }
        $path = Join-Path $folder $relative
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Package file missing: $relative" }
        $actual = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -ne [string]$entry.sha256 -or (Get-Item -LiteralPath $path).Length -ne $entry.bytes) {
            throw "Package integrity check failed: $relative"
        }
    }
}

Assert-PackageFiles $source $manifest.files
$folderName = "candidate-$($manifest.version)-$($manifest.source.Substring(0, 12))"
$destination = Join-Path $InstallRoot $folderName
if (Test-Path -LiteralPath $destination) { throw "Already installed: $destination" }
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
Copy-Item -LiteralPath $source -Destination $destination -Recurse
Assert-PackageFiles $destination $manifest.files
$executable = Join-Path $destination 'BrontideDesktop/BrontideDesktop.exe'
& $executable --check-assets
if ($LASTEXITCODE -ne 0) { throw 'Installed candidate failed its asset check.' }

if (-not $NoShortcut) {
    $menu = Join-Path $env:APPDATA 'Microsoft/Windows/Start Menu/Programs'
    $link = Join-Path $menu 'Brontide Candidate.lnk'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($link)
    $shortcut.TargetPath = $executable
    $shortcut.WorkingDirectory = Split-Path -Path $executable -Parent
    $shortcut.Description = 'Locked local Brontide trading sample'
    $shortcut.Save()
}
Write-Output "Installed locked candidate at: $destination"
Write-Output 'Open Brontide Candidate from Start. Broker execution remains disabled.'
