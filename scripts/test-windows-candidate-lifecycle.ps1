# Focused, isolated lifecycle proof. Requires rustc only to build a tiny fake exe.
# Does not start Brontide, contact a broker, or read a real profile.
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Windows required.' }
if (-not (Get-Command rustc -ErrorAction SilentlyContinue)) { throw 'rustc is required for this isolated fixture test.' }

$repo = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$installer = Join-Path $PSScriptRoot 'install-windows-candidate.ps1'
$id = [guid]::NewGuid().ToString('N')
$fixtureBase = Join-Path $repo "output/modular-candidate/lifecycle-fixture-$id"
$programs = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Programs'))
$installed = Join-Path $programs "Brontide-Lifecycle-$id"
$shortcut = Join-Path $env:APPDATA "Microsoft/Windows/Start Menu/Programs/Brontide Candidate Brontide-Lifecycle-$id.lnk"
$aSource = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
$bSource = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
$aName = 'candidate-1.0.0-aaaaaaaaaaaa'
$bName = 'candidate-1.1.0-bbbbbbbbbbbb'
$outsideSentinel = Join-Path $fixtureBase 'outside-sentinel.txt'

function Assert-Equal($actual, $expected, [string]$message) {
    if ($actual -cne $expected) { throw "$message; actual=$actual; expected=$expected" }
}
function Expect-Failure([scriptblock]$action, [string]$message) {
    try { & $action | Out-Null }
    catch { Write-Output "PASS rejected: $message"; return }
    throw "Expected rejection: $message"
}
function Make-Package([string]$folder, [string]$version, [string]$source, [int]$profileSchema) {
    $path = Join-Path $fixtureBase $folder
    $bin = Join-Path $path 'BrontideDesktop'
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $fixtureBase 'stub.exe') -Destination (Join-Path $bin 'BrontideDesktop.exe')
    Copy-Item -LiteralPath $installer -Destination (Join-Path $path 'Install-Brontide.ps1')
    'locked fixture' | Set-Content -LiteralPath (Join-Path $path 'README.txt') -Encoding utf8
    $files = @(Get-ChildItem -LiteralPath $path -File -Recurse | Sort-Object FullName | ForEach-Object {
        [ordered]@{
            path = $_.FullName.Substring($path.Length + 1).Replace('\', '/')
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            bytes = $_.Length
        }
    })
    [ordered]@{
        schema = 1; platform = 'windows-x64'; brokerExecution = 'disabled'; signed = $false
        source = $source; version = $version; profileSchema = $profileSchema; storeSchema = 0
        files = $files
    } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $path 'manifest.json') -Encoding utf8
    $path
}
function ActiveName { (Get-Content -LiteralPath (Join-Path $installed 'installation.json') -Raw | ConvertFrom-Json).active }
function ShortcutTarget {
    $shell = New-Object -ComObject WScript.Shell
    [string]$shell.CreateShortcut($shortcut).TargetPath
}
function Invoke-Lifecycle([string]$action, [string]$package = '', [string]$target = '') {
    $arguments = @{ Action = $action; InstallRoot = $installed }
    if ($package) { $arguments.PackageRoot = $package }
    if ($target) { $arguments.TargetFolder = $target }
    & $installer @arguments
}

try {
    New-Item -ItemType Directory -Path $fixtureBase -Force | Out-Null
    $sourceCode = Join-Path $fixtureBase 'stub.rs'
    @'
fn main() {
    let reject = std::env::var("BRONTIDE_LIFECYCLE_STUB_REJECT_SCHEMA").unwrap_or_default();
    if reject == "1" && std::env::args().any(|arg| arg == "--check-profile-schema") {
        std::process::exit(7);
    }
}
'@ | Set-Content -LiteralPath $sourceCode -Encoding utf8
    & rustc $sourceCode -o (Join-Path $fixtureBase 'stub.exe')
    if ($LASTEXITCODE -ne 0) { throw 'Could not compile isolated lifecycle stub.' }
    'do not remove' | Set-Content -LiteralPath $outsideSentinel -Encoding utf8
    $a = Make-Package 'package-a' '1.0.0' $aSource 1
    $b = Make-Package 'package-b' '1.1.0' $bSource 1
    $collision = Make-Package 'package-prefix-collision' '1.1.0' (('b' * 12) + ('c' * 28)) 1
    $future = Make-Package 'package-future-schema' '1.2.0' ('c' * 40) 2

    Invoke-Lifecycle 'Install' $a | Out-Null
    Assert-Equal (ActiveName) $aName 'Install did not select A'
    if (-not (Test-Path -LiteralPath $shortcut)) { throw 'Install shortcut missing.' }
    Assert-Equal (ShortcutTarget) (Join-Path $installed "$aName/BrontideDesktop/BrontideDesktop.exe") 'Initial shortcut target'
    Write-Output 'PASS initial install and owned shortcut'

    Expect-Failure { Invoke-Lifecycle 'Update' (Join-Path $installed $aName) } 'self-copy from managed installation'
    Assert-Equal (ActiveName) $aName 'Rejected self-copy changed active version'

    Expect-Failure { Invoke-Lifecycle 'Update' $future } 'schema 2 package'
    Assert-Equal (ActiveName) $aName 'Rejected schema changed active version'
    $env:BRONTIDE_LIFECYCLE_STUB_REJECT_SCHEMA = '1'
    Expect-Failure { Invoke-Lifecycle 'Update' $b } 'runtime profile-schema rejection'
    Assert-Equal (ActiveName) $aName 'Rejected runtime check changed active version'
    Remove-Item Env:BRONTIDE_LIFECYCLE_STUB_REJECT_SCHEMA -ErrorAction SilentlyContinue

    Invoke-Lifecycle 'Update' $b | Out-Null
    Assert-Equal (ActiveName) $bName 'Update did not select B'
    Assert-Equal (ShortcutTarget) (Join-Path $installed "$bName/BrontideDesktop/BrontideDesktop.exe") 'Updated shortcut target'
    if (-not (Test-Path -LiteralPath (Join-Path $installed $aName))) { throw 'Update discarded rollback candidate.' }
    Expect-Failure { Invoke-Lifecycle 'Update' $a } 'downgrade via Update'
    Assert-Equal (ActiveName) $bName 'Rejected downgrade changed active version'
    Write-Output 'PASS update, retained prior version, and downgrade rejection'

    Expect-Failure { Invoke-Lifecycle 'Rollback' '' '../escape' } 'rollback path traversal'
    Invoke-Lifecycle 'Rollback' '' $aName | Out-Null
    Assert-Equal (ActiveName) $aName 'Rollback did not select A'
    Assert-Equal (ShortcutTarget) (Join-Path $installed "$aName/BrontideDesktop/BrontideDesktop.exe") 'Rollback shortcut target'
    Write-Output 'PASS explicit rollback'

    Expect-Failure { Invoke-Lifecycle 'Update' $collision } 'same short source prefix with different full source'
    Assert-Equal (ActiveName) $aName 'Rejected source collision changed active version'

    'tampered' | Add-Content -LiteralPath (Join-Path $installed "$bName/README.txt")
    Expect-Failure { Invoke-Lifecycle 'Uninstall' } 'tampered installed version'
    Assert-Equal (ActiveName) $aName 'Rejected uninstall changed active version'
    Copy-Item -LiteralPath (Join-Path $b 'README.txt') -Destination (Join-Path $installed "$bName/README.txt") -Force

    & (Join-Path $installed "$aName/Install-Brontide.ps1") -Action Uninstall -InstallRoot $installed | Out-Null
    if (Test-Path -LiteralPath (Join-Path $installed $aName)) { throw 'Uninstall left version A.' }
    if (Test-Path -LiteralPath (Join-Path $installed $bName)) { throw 'Uninstall left version B.' }
    if (Test-Path -LiteralPath $shortcut) { throw 'Uninstall left owned shortcut.' }
    if (-not (Test-Path -LiteralPath $outsideSentinel)) { throw 'Uninstall removed unrelated sentinel.' }
    Write-Output 'PASS per-user uninstall preserves unrelated data'
} finally {
    Remove-Item Env:BRONTIDE_LIFECYCLE_STUB_REJECT_SCHEMA -ErrorAction SilentlyContinue
    # These paths were constructed above from fixed parents and one fresh GUID.
    $expectedInstall = [IO.Path]::GetFullPath((Join-Path $programs "Brontide-Lifecycle-$id"))
    $expectedFixture = [IO.Path]::GetFullPath((Join-Path $repo "output/modular-candidate/lifecycle-fixture-$id"))
    if ([string]::Equals([IO.Path]::GetFullPath($installed), $expectedInstall, [StringComparison]::OrdinalIgnoreCase) -and
        (Test-Path -LiteralPath $installed) -and
        -not ((Get-Item -LiteralPath $installed -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Remove-Item -LiteralPath $installed -Recurse -Force
    }
    if ((Test-Path -LiteralPath $shortcut) -and
        -not ((Get-Item -LiteralPath $shortcut -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Remove-Item -LiteralPath $shortcut
    }
    if ([string]::Equals([IO.Path]::GetFullPath($fixtureBase), $expectedFixture, [StringComparison]::OrdinalIgnoreCase) -and
        (Test-Path -LiteralPath $fixtureBase) -and
        -not ((Get-Item -LiteralPath $fixtureBase -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        Remove-Item -LiteralPath $fixtureBase -Recurse -Force
    }
}
