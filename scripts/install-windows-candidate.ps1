# Per-user lifecycle of an already obtained, locked Windows candidate.
# No download, elevation, service change, broker action, or private-data deletion.
param(
    [ValidateSet('Install', 'Update', 'Rollback', 'List', 'Uninstall')]
    [string]$Action = 'Install',
    [string]$PackageRoot = $PSScriptRoot,
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs/Brontide'),
    [string]$TargetFolder,
    [switch]$NoShortcut
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows is required.' }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Use a normal, non-elevated PowerShell window.'
}

function FullPath([string]$path) { [IO.Path]::GetFullPath($path).TrimEnd('\', '/') }
function SamePath([string]$a, [string]$b) {
    [string]::Equals((FullPath $a), (FullPath $b), [StringComparison]::OrdinalIgnoreCase)
}
function Assert-Directory([string]$path) {
    if (-not (Test-Path -LiteralPath $path -PathType Container)) { throw "Directory unavailable: $path" }
    if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Reparse directory refused: $path"
    }
}
function Assert-File([string]$path) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "File unavailable: $path" }
    if ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Reparse file refused: $path"
    }
}

# All recursive copies and removals stay inside this user's direct Programs child.
$knownLocalData = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
if (-not $knownLocalData) { throw 'Windows LocalAppData could not be resolved.' }
$localData = FullPath $knownLocalData
$programs = FullPath (Join-Path $localData 'Programs')
$root = FullPath $InstallRoot
if (-not (SamePath ([IO.Path]::GetDirectoryName($root)) $programs) -or
    [IO.Path]::GetFileName($root) -notmatch '^Brontide(?:-[A-Za-z0-9-]{1,48})?$') {
    throw 'InstallRoot must be a direct Brontide-named child of this user LocalAppData/Programs.'
}
Assert-Directory $localData
if (Test-Path -LiteralPath $programs) { Assert-Directory $programs }
if (Test-Path -LiteralPath $root) { Assert-Directory $root }
$statePath = Join-Path $root 'installation.json'
$shortcutLabel = if ([IO.Path]::GetFileName($root) -eq 'Brontide') {
    'Brontide Candidate.lnk'
} else { "Brontide Candidate $([IO.Path]::GetFileName($root)).lnk" }
$knownRoamingData = [Environment]::GetFolderPath([Environment+SpecialFolder]::ApplicationData)
if (-not $knownRoamingData) { throw 'Windows AppData could not be resolved.' }
$shortcutPath = Join-Path $knownRoamingData "Microsoft/Windows/Start Menu/Programs/$shortcutLabel"

function Assert-SourceOutsideRoot([string]$source) {
    if ((SamePath $source $root) -or
        $source.StartsWith(($root + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) {
        throw 'PackageRoot must be outside the managed installation root.'
    }
    $ancestor = $source
    while ($ancestor) {
        if ((Test-Path -LiteralPath $ancestor) -and
            ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "PackageRoot traverses a reparse point: $ancestor"
        }
        $parent = [IO.Path]::GetDirectoryName($ancestor)
        if (-not $parent -or (SamePath $parent $ancestor)) { break }
        $ancestor = $parent
    }
}

function CandidatePath([string]$name) {
    if ($name -notmatch '^candidate-[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{12}$') {
        throw "Invalid candidate folder name: $name"
    }
    $path = FullPath (Join-Path $root $name)
    if (-not (SamePath ([IO.Path]::GetDirectoryName($path)) $root)) {
        throw 'Candidate folder escaped InstallRoot.'
    }
    $path
}
function CandidateExe([string]$name) { Join-Path (CandidatePath $name) 'BrontideDesktop/BrontideDesktop.exe' }
function CandidateNames {
    if (-not (Test-Path -LiteralPath $root)) { return @() }
    @(Get-ChildItem -LiteralPath $root -Force | Where-Object { $_.Name -like 'candidate-*' } |
        ForEach-Object { $_.Name })
}
function Assert-NoPendingCopy {
    if (-not (Test-Path -LiteralPath $root)) { return }
    $pending = @(Get-ChildItem -LiteralPath $root -Force |
        Where-Object { $_.Name -like '.candidate-pending-*' })
    if ($pending.Count -gt 0) {
        throw 'An interrupted candidate copy remains. Preserve and review it before changing installed versions.'
    }
}
function Read-Manifest([string]$folder) {
    Assert-Directory $folder
    $path = Join-Path $folder 'manifest.json'
    Assert-File $path
    $m = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    if ($m.schema -ne 1 -or $m.platform -ne 'windows-x64' -or
        $m.brokerExecution -ne 'disabled' -or $m.signed -ne $false -or
        $m.source -notmatch '^[0-9a-f]{40}$' -or
        $m.version -notmatch '^[0-9]+\.[0-9]+\.[0-9]+$' -or
        $m.profileSchema -ne 1 -or $m.storeSchema -ne 0 -or
        -not ($m.files -is [Array]) -or $m.files.Count -lt 1) {
        throw 'Manifest identity, locked status, or data schema is unsupported.'
    }
    $m
}
function PackageItems([string]$folder) {
    $queue = New-Object 'System.Collections.Generic.Stack[string]'
    $queue.Push($folder)
    while ($queue.Count -gt 0) {
        $directory = $queue.Pop()
        foreach ($item in @(Get-ChildItem -LiteralPath $directory -Force)) {
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Package reparse point refused: $($item.FullName)"
            }
            $item
            if ($item.PSIsContainer) { $queue.Push($item.FullName) }
        }
    }
}
function Assert-Package([string]$folder, $m) {
    Assert-Directory $folder
    $expected = @($m.files | ForEach-Object { [string]$_.path })
    if (@($expected | Select-Object -Unique).Count -ne $expected.Count) {
        throw 'Duplicate manifest file path.'
    }
    $items = @(PackageItems $folder)
    $prefix = (FullPath $folder) + [IO.Path]::DirectorySeparatorChar
    $actual = @($items | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
        if (-not $_.FullName.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Package file escaped its root.'
        }
        $_.FullName.Substring($prefix.Length).Replace('\', '/')
    } | Where-Object { $_ -ne 'manifest.json' })
    if (@(Compare-Object -ReferenceObject $expected -DifferenceObject $actual).Count -ne 0) {
        throw 'Package contains missing or unlisted files.'
    }
    foreach ($entry in $m.files) {
        $rel = [string]$entry.path
        if (-not $rel -or $rel.StartsWith('/') -or $rel.Contains('..') -or
            $rel.Contains(':') -or $rel.Contains('\') -or
            # Dependencies may contain internal spaces (for example Lorem ipsum.txt).
            # Reject empty segments and Windows-normalized trailing spaces/dots.
            $rel -notmatch '^[A-Za-z0-9._ /+-]+$' -or
            @($rel.Split('/') | Where-Object { -not $_ -or $_ -match '^[ ]|[ .]$' }).Count -gt 0 -or
            [string]$entry.sha256 -notmatch '^[0-9a-f]{64}$' -or
            $entry.bytes -isnot [long] -and $entry.bytes -isnot [int]) {
            throw "Unsafe inventory entry: $rel"
        }
        $file = Join-Path $folder $rel
        Assert-File $file
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.sha256 -or
            (Get-Item -LiteralPath $file).Length -ne $entry.bytes) {
            throw "Package integrity failure: $rel"
        }
    }
}
function Read-Installed([string]$name) {
    $path = CandidatePath $name
    $m = Read-Manifest $path
    if ($name -cne "candidate-$($m.version)-$($m.source.Substring(0,12))") {
        throw 'Installed folder does not match manifest identity.'
    }
    Assert-Package $path $m
    [pscustomobject]@{ Name = $name; Path = $path; Manifest = $m }
}
function Read-State {
    if (-not (Test-Path -LiteralPath $statePath)) { return $null }
    Assert-File $statePath
    $s = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($s.schema -ne 1 -or $s.active -notmatch '^candidate-[0-9]+\.[0-9]+\.[0-9]+-[0-9a-f]{12}$' -or
        ((@($s.PSObject.Properties.Name | Sort-Object) -join ',') -ne 'active,schema')) {
        throw 'Installation state is damaged or unsupported.'
    }
    [void](Read-Installed ([string]$s.active))
    $s
}
function Write-State([string]$name) {
    $temp = Join-Path $root (".installation-$([guid]::NewGuid().ToString('N')).tmp")
    $backup = Join-Path $root (".installation-$([guid]::NewGuid().ToString('N')).bak")
    try {
        @{ schema = 1; active = $name } | ConvertTo-Json -Compress |
            Set-Content -LiteralPath $temp -Encoding UTF8
        if (Test-Path -LiteralPath $statePath) {
            Assert-File $statePath
            [IO.File]::Replace($temp, $statePath, $backup)
        } else { [IO.File]::Move($temp, $statePath) }
    } finally {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp }
        if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup }
    }
}
function Assert-Stopped {
    $prefix = $root + [IO.Path]::DirectorySeparatorChar
    foreach ($process in @(Get-Process -Name BrontideDesktop -ErrorAction SilentlyContinue)) {
        try { $path = [string]$process.Path }
        catch { throw 'Cannot establish whether a BrontideDesktop process uses this installation.' }
        if (-not $path) { throw 'Cannot establish whether a BrontideDesktop process uses this installation.' }
        if ($path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Close this BrontideDesktop installation before changing installed versions.'
        }
    }
}
function Assert-Executable([string]$name) {
    $exe = CandidateExe $name
    Assert-File $exe
    & $exe --check-assets
    if ($LASTEXITCODE -ne 0) { throw 'Installed candidate asset check failed.' }
    & $exe --check-profile-schema
    if ($LASTEXITCODE -ne 0) { throw 'Installed candidate rejected this user profile schema.' }
}
function ShortcutTarget {
    if (-not (Test-Path -LiteralPath $shortcutPath)) { return $null }
    Assert-File $shortcutPath
    $shell = New-Object -ComObject WScript.Shell
    [string]$shell.CreateShortcut($shortcutPath).TargetPath
}
function Assert-OwnedShortcut($state) {
    if (-not (Test-Path -LiteralPath $shortcutPath)) { return }
    $target = ShortcutTarget
    if (-not $target -or $null -eq $state -or
        -not (SamePath $target (CandidateExe ([string]$state.active)))) {
        throw 'Existing Brontide shortcut does not target this managed installation.'
    }
}
function Set-Shortcut([string]$name) {
    $exe = CandidateExe $name
    $menu = Split-Path -Path $shortcutPath -Parent
    Assert-Directory $menu
    $temp = Join-Path $menu ("Brontide Candidate-$([guid]::NewGuid().ToString('N')).lnk")
    try {
        $shell = New-Object -ComObject WScript.Shell
        $link = $shell.CreateShortcut($temp)
        $link.TargetPath = $exe
        $link.WorkingDirectory = Split-Path -Path $exe -Parent
        $link.Description = 'Locked local Brontide trading sample'
        $link.Save()
        Move-Item -LiteralPath $temp -Destination $shortcutPath -Force
    } finally {
        if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp }
    }
}
function Switch-Active([string]$name, $old) {
    Assert-Executable $name
    Assert-OwnedShortcut $old
    if ($NoShortcut -and (Test-Path -LiteralPath $shortcutPath)) {
        throw 'The existing shortcut must be updated with the active version. Omit -NoShortcut.'
    }
    $changed = $false
    try {
        if (-not $NoShortcut) { Set-Shortcut $name; $changed = $true }
        Write-State $name
    } catch {
        if ($changed) {
            if ($null -ne $old) { Set-Shortcut ([string]$old.active) }
            elseif (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
        }
        throw
    }
}
function Assert-NoLegacy($state) {
    if ($null -eq $state -and @(CandidateNames).Count -gt 0) {
        throw 'Legacy candidate folders have no lifecycle state. Preserve and review them separately.'
    }
}

# A share-exclusive file under the owning user's Programs directory serializes
# lifecycle changes across processes and Windows logon sessions for this root.
# The file is intentionally retained; OS handle closure releases the lock after
# a crash, while the pending-copy and state checks still inspect its aftermath.
$lifecycleLock = $null
if ($Action -ne 'List') {
    if (-not (Test-Path -LiteralPath $programs)) {
        New-Item -ItemType Directory -Path $programs -Force | Out-Null
    }
    Assert-Directory $programs
    $lockPath = Join-Path $programs ('.brontide-lifecycle-' + [IO.Path]::GetFileName($root) + '.lock')
    if (Test-Path -LiteralPath $lockPath) { Assert-File $lockPath }
    try {
        $lifecycleLock = [IO.FileStream]::new($lockPath,
            [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    } catch [IO.IOException] {
        throw 'Lifecycle lock unavailable: another operation or a storage error. No installation change was made.'
    }
}
try {
switch ($Action) {
    'List' {
        $state = Read-State
        foreach ($name in @(CandidateNames)) {
            $installed = Read-Installed $name
            [pscustomobject]@{ Folder = $name; Active = ($null -ne $state -and $state.active -eq $name);
                Version = $installed.Manifest.version; Source = $installed.Manifest.source }
        }
        break
    }
    'Install' {
        Assert-Stopped
        $state = Read-State
        Assert-NoPendingCopy
        Assert-NoLegacy $state
        if ($null -ne $state) { throw 'Already installed. Use -Action Update.' }
        $source = FullPath $PackageRoot
        Assert-SourceOutsideRoot $source
        $m = Read-Manifest $source
        Assert-Package $source $m
        $name = "candidate-$($m.version)-$($m.source.Substring(0,12))"
        $destination = CandidatePath $name
        if (Test-Path -LiteralPath $destination) { throw 'Candidate already installed.' }
        Assert-OwnedShortcut $null
        if (-not (Test-Path -LiteralPath $programs)) { New-Item -ItemType Directory -Path $programs | Out-Null }
        if (-not (Test-Path -LiteralPath $root)) { New-Item -ItemType Directory -Path $root | Out-Null }
        Assert-Directory $programs
        Assert-Directory $root
        $pending = Join-Path $root (".candidate-pending-$([guid]::NewGuid().ToString('N'))")
        try {
            Copy-Item -LiteralPath $source -Destination $pending -Recurse
            Assert-Package $pending $m
            Move-Item -LiteralPath $pending -Destination $destination
            [void](Read-Installed $name)
            Switch-Active $name $null
        } catch {
            if (-not (Test-Path -LiteralPath $statePath) -and (Test-Path -LiteralPath $destination)) {
                Assert-Directory $destination
                Remove-Item -LiteralPath $destination -Recurse -Force
            }
            throw
        } finally {
            if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Recurse -Force }
        }
        Write-Output "Installed locked candidate: $destination"
        break
    }
    'Update' {
        Assert-Stopped
        $state = Read-State
        Assert-NoPendingCopy
        if ($null -eq $state) { throw 'No managed installation. Use -Action Install.' }
        $source = FullPath $PackageRoot
        Assert-SourceOutsideRoot $source
        $m = Read-Manifest $source
        Assert-Package $source $m
        $active = Read-Installed ([string]$state.active)
        if ($m.profileSchema -ne $active.Manifest.profileSchema -or
            $m.storeSchema -ne $active.Manifest.storeSchema) {
            throw 'Data schema differs from active version. Reviewed migration required.'
        }
        if ([version]$m.version -lt [version]$active.Manifest.version) {
            throw 'Use -Action Rollback for an older version.'
        }
        $name = "candidate-$($m.version)-$($m.source.Substring(0,12))"
        if ($name -eq $state.active) { throw 'Exact candidate already active.' }
        $destination = CandidatePath $name
        if (Test-Path -LiteralPath $destination) {
            $existing = Read-Installed $name
            if ($existing.Manifest.source -cne $m.source -or
                $existing.Manifest.version -cne $m.version -or
                (@($existing.Manifest.files | ConvertTo-Json -Depth 5 -Compress) -join '') -cne
                (@($m.files | ConvertTo-Json -Depth 5 -Compress) -join '')) {
                throw 'Existing candidate does not match the supplied package identity and inventory.'
            }
        }
        else {
            $pending = Join-Path $root (".candidate-pending-$([guid]::NewGuid().ToString('N'))")
            try {
                Copy-Item -LiteralPath $source -Destination $pending -Recurse
                Assert-Package $pending $m
                Move-Item -LiteralPath $pending -Destination $destination
                [void](Read-Installed $name)
            } finally {
                if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending -Recurse -Force }
            }
        }
        Switch-Active $name $state
        Write-Output "Active locked candidate: $destination"
        Write-Output "Previous version retained: $($active.Path)"
        break
    }
    'Rollback' {
        Assert-Stopped
        $state = Read-State
        Assert-NoPendingCopy
        if ($null -eq $state) { throw 'No managed installation.' }
        if (-not $TargetFolder) { throw 'Specify -TargetFolder from -Action List.' }
        if ($TargetFolder -eq $state.active) { throw 'That version is active.' }
        $target = Read-Installed $TargetFolder
        $active = Read-Installed ([string]$state.active)
        if ($target.Manifest.profileSchema -ne $active.Manifest.profileSchema -or
            $target.Manifest.storeSchema -ne $active.Manifest.storeSchema) {
            throw 'Rollback schema differs from active version. Reviewed migration required.'
        }
        Switch-Active $TargetFolder $state
        Write-Output "Rolled back to: $($target.Path)"
        break
    }
    'Uninstall' {
        Assert-Stopped
        $state = Read-State
        Assert-NoPendingCopy
        Assert-NoLegacy $state
        if ($null -eq $state) { Write-Output 'No managed candidate installed.'; break }
        Assert-OwnedShortcut $state
        $names = @(CandidateNames)
        foreach ($name in $names) { [void](Read-Installed $name) }
        if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
        foreach ($name in $names) {
            $path = CandidatePath $name
            Assert-Directory $path
            Remove-Item -LiteralPath $path -Recurse -Force
        }
        Assert-File $statePath
        Remove-Item -LiteralPath $statePath
        Write-Output 'Removed managed binaries and shortcut. Private profile and trading data were preserved.'
        break
    }
}
} finally {
    if ($null -ne $lifecycleLock) { $lifecycleLock.Dispose() }
}
