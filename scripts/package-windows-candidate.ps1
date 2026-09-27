# Build an unsigned, locked desktop candidate. This is not a public release.
param(
    [string]$Python = "services/eod/.venv/Scripts/python.exe",
    [string]$OutputRoot = "output/modular-candidate"
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$pythonPath = (Resolve-Path -LiteralPath (Join-Path $repoRoot $Python)).Path
$outputPath = [System.IO.Path]::GetFullPath((Join-Path $repoRoot $OutputRoot))
$allowedOutput = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'output/modular-candidate'))
if (-not [string]::Equals($outputPath, $allowedOutput, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Candidate build output must stay in this checkout under output/modular-candidate.'
}
foreach ($directory in @((Join-Path $repoRoot 'output'), $outputPath)) {
    if ((Test-Path -LiteralPath $directory) -and
        ((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Candidate output path must not traverse a reparse point.'
    }
}
$packageVersion = (Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw | ConvertFrom-Json).version
$source = (& git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'A Git source revision is required.' }
$dirty = [bool]((& git -C $repoRoot status --porcelain --untracked-files=normal) | Select-Object -First 1)
$suffix = if ($dirty) { '-dirty' } else { '' }
$buildStamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$candidateName = "Brontide-$packageVersion-$($source.Substring(0, 12))$suffix-win-x64-$buildStamp"
$stage = Join-Path $outputPath $candidateName
$assetStage = Join-Path $outputPath "standalone-assets-$buildStamp"
$identityExpression = "import { getPreviewIdentity } from './scripts/preview-identity.mjs'; console.log(getPreviewIdentity().identifier)"
if ((Test-Path -LiteralPath $stage) -or (Test-Path -LiteralPath $assetStage)) {
    throw 'A candidate or asset stage already exists for this build timestamp; preserve it for review.'
}

if (-not $IsWindows -and $env:OS -ne 'Windows_NT') { throw 'Build this candidate on Windows.' }
if ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne 'X64') {
    throw 'Only Windows x64 is supported by this candidate.'
}
$toolVersion = (& $pythonPath -m PyInstaller --version).Trim()
if ($LASTEXITCODE -ne 0 -or $toolVersion -ne '6.22.3') {
    throw 'Install PyInstaller 6.22.3 into the private build venv first.'
}

Push-Location $repoRoot
$previousBuildEnvironment = @{}
foreach ($name in @('BRONTIDE_LOCAL_BUILD', 'BRONTIDE_STANDALONE_BUILD', 'NEXT_PUBLIC_BRONTIDE_UI_TEST_LOCAL', 'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY')) {
    $previousBuildEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
try {
    $previewBefore = (& node --input-type=module -e $identityExpression).Trim()
    $env:BRONTIDE_LOCAL_BUILD = '1'
    $env:BRONTIDE_STANDALONE_BUILD = '1'
    $env:NEXT_PUBLIC_BRONTIDE_UI_TEST_LOCAL = ''
    # Next loads .env.local by default. Explicit empty variables take precedence
    # so a contributor's cloud project configuration cannot enter this bundle.
    $env:NEXT_PUBLIC_SUPABASE_URL = ''
    $env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = ''
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Static frontend build failed.' }
    $previewAfter = (& node --input-type=module -e $identityExpression).Trim()
    if ($previewBefore -ne $previewAfter) {
        throw 'Source changed during the frontend build; rebuild from a stable checkout.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'out/standalone/index.html'))) {
        throw 'The standalone frontend route was not exported.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $repoRoot 'out/verification/index.html'))) {
        throw 'The read-only Trading verification route was not exported.'
    }
    # Qualify the complete fresh export, including routes and orphan text assets
    # that are not selected for the desktop payload.
    & (Join-Path $PSScriptRoot 'assert-standalone-asset-boundary.ps1') -AssetRoot (Join-Path $repoRoot 'out')
    New-Item -ItemType Directory -Path $assetStage -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot 'out/standalone') -Destination (Join-Path $assetStage 'standalone') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot 'out/verification') -Destination (Join-Path $assetStage 'verification') -Recurse -Force
    # Copy the complete export until an emitted-asset graph can be proved.
    # The subsequent whole-stage cloud scan fails closed on any orphan chunk.
    Copy-Item -LiteralPath (Join-Path $repoRoot 'out/_next') -Destination (Join-Path $assetStage '_next') -Recurse -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot 'out/favicon.svg') -Destination (Join-Path $assetStage 'favicon.svg')
    $forbiddenPatterns = @(
        '[a-z0-9-]{16,}\.supabase\.co',
        'sb_publishable_[A-Za-z0-9_-]{20,}',
        'C:\\Users\\',
        'paper-lifecycle\.sqlite3'
    )
    foreach ($pattern in $forbiddenPatterns) {
        $matches = @(Get-ChildItem -LiteralPath $assetStage -File -Recurse -Force -ErrorAction Stop |
            Select-String -Pattern $pattern -Quiet -ErrorAction Stop)
        if ($matches -contains $true) { throw 'The standalone export contains cloud configuration or a private-path marker.' }
    }
    & (Join-Path $PSScriptRoot 'assert-standalone-asset-boundary.ps1') -AssetRoot $assetStage
    if ($LASTEXITCODE -ne 0) { throw 'Standalone cloud-auth boundary check failed.' }
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    $dist = Join-Path $stage 'BrontideDesktop'
    $work = Join-Path $outputPath 'pyinstaller-work'
    $spec = Join-Path $outputPath 'pyinstaller-spec'
    & $pythonPath -m PyInstaller --onedir --name BrontideDesktop --noconfirm --clean `
        --distpath $stage --workpath $work --specpath $spec `
        --add-data "$assetStage;out" `
        (Join-Path $repoRoot 'scripts/standalone_entry.py')
    if ($LASTEXITCODE -ne 0) { throw 'Desktop packaging failed.' }
    # Recheck the actual PyInstaller payload, not only its input staging tree.
    & (Join-Path $PSScriptRoot 'assert-standalone-asset-boundary.ps1') -AssetRoot (Join-Path $dist '_internal/out')
    & (Join-Path $dist 'BrontideDesktop.exe') --check-assets
    if ($LASTEXITCODE -ne 0) { throw 'Packaged asset self-check failed.' }
    $diagnosticsRaw = & (Join-Path $dist 'BrontideDesktop.exe') --diagnostics
    if ($LASTEXITCODE -ne 0) { throw 'Packaged read-only diagnostics failed.' }
    try { $diagnostics = $diagnosticsRaw | ConvertFrom-Json -ErrorAction Stop }
    catch { throw 'Packaged diagnostics did not return valid JSON.' }
    $diagnosticFields = @($diagnostics.PSObject.Properties.Name | Sort-Object)
    $expectedFields = @('brokerConnection', 'candidate', 'executionEnabled', 'packagedAssets', 'profileSchema', 'schemaVersion')
    if ((Compare-Object $diagnosticFields $expectedFields -CaseSensitive) -or
        $diagnostics.schemaVersion -ne 1 -or $diagnostics.candidate -ne 'locked-sample' -or
        $diagnostics.executionEnabled -ne $false -or
        $diagnostics.brokerConnection -ne 'not-available' -or
        $diagnostics.packagedAssets -ne 'valid') {
        throw 'Packaged diagnostics did not confirm a valid, execution-locked candidate.'
    }

    Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination (Join-Path $stage 'LICENSE')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'docs/trading/CANDIDATE_INSTALL.md') -Destination (Join-Path $stage 'README-CANDIDATE.md')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'scripts/install-windows-candidate.ps1') -Destination (Join-Path $stage 'Install-Brontide.ps1')
    # Windows PowerShell 5.1 uses .NET Framework, which has no Path.GetRelativePath.
    $stagePrefix = [System.IO.Path]::GetFullPath($stage).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    $files = Get-ChildItem -LiteralPath $stage -File -Recurse -Force -ErrorAction Stop | Sort-Object FullName | ForEach-Object {
        $fileFullPath = [System.IO.Path]::GetFullPath($_.FullName)
        if (-not $fileFullPath.StartsWith($stagePrefix, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Packaged file escaped the candidate staging directory.'
        }
        [ordered]@{
            path = $fileFullPath.Substring($stagePrefix.Length).Replace('\', '/')
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            bytes = $_.Length
        }
    }
    $manifest = [ordered]@{
        schema = 1
        product = 'Brontide desktop candidate'
        version = $packageVersion
        source = $source
        previewIdentity = $previewAfter
        dirty = $dirty
        platform = 'windows-x64'
        brokerExecution = 'disabled'
        signed = $false
        profileSchema = 1
        storeSchema = 0
        generatedUtc = [DateTime]::UtcNow.ToString('o')
        files = @($files)
    }
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $stage 'manifest.json') -Encoding utf8
    $archive = Join-Path $outputPath "$candidateName.zip"
    if (Test-Path -LiteralPath $archive) { throw 'Candidate archive already exists; preserve it for review.' }
    Compress-Archive -LiteralPath $stage -DestinationPath $archive
    Write-Output "Candidate: $archive"
    Write-Output "Source: $source; dirty: $dirty; signed: false; broker execution: disabled"
} finally {
    Pop-Location
    foreach ($name in $previousBuildEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousBuildEnvironment[$name], 'Process')
    }
}
