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
    New-Item -ItemType Directory -Path $assetStage -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot 'out/standalone') -Destination (Join-Path $assetStage 'standalone') -Recurse
    Copy-Item -LiteralPath (Join-Path $repoRoot 'out/verification') -Destination (Join-Path $assetStage 'verification') -Recurse
    Copy-Item -LiteralPath (Join-Path $repoRoot 'out/_next') -Destination (Join-Path $assetStage '_next') -Recurse
    Copy-Item -LiteralPath (Join-Path $repoRoot 'out/favicon.svg') -Destination (Join-Path $assetStage 'favicon.svg')
    $forbiddenPatterns = @(
        '[a-z0-9-]{16,}\.supabase\.co',
        'sb_publishable_[A-Za-z0-9_-]{20,}',
        'C:\\Users\\',
        'paper-lifecycle\.sqlite3'
    )
    foreach ($pattern in $forbiddenPatterns) {
        $matches = @(Get-ChildItem -LiteralPath $assetStage -File -Recurse |
            Select-String -Pattern $pattern -Quiet -ErrorAction Stop)
        if ($matches -contains $true) { throw 'The standalone export contains cloud configuration or a private-path marker.' }
    }
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    $dist = Join-Path $stage 'BrontideDesktop'
    $work = Join-Path $outputPath 'pyinstaller-work'
    $spec = Join-Path $outputPath 'pyinstaller-spec'
    & $pythonPath -m PyInstaller --onedir --name BrontideDesktop --noconfirm --clean `
        --distpath $stage --workpath $work --specpath $spec `
        --add-data "$assetStage;out" `
        (Join-Path $repoRoot 'scripts/standalone_entry.py')
    if ($LASTEXITCODE -ne 0) { throw 'Desktop packaging failed.' }
    & (Join-Path $dist 'BrontideDesktop.exe') --check-assets
    if ($LASTEXITCODE -ne 0) { throw 'Packaged asset self-check failed.' }

    Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination (Join-Path $stage 'LICENSE')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'docs/trading/CANDIDATE_INSTALL.md') -Destination (Join-Path $stage 'README-CANDIDATE.md')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'scripts/install-windows-candidate.ps1') -Destination (Join-Path $stage 'Install-Brontide.ps1')
    $files = Get-ChildItem -LiteralPath $stage -File -Recurse | Sort-Object FullName | ForEach-Object {
        [ordered]@{
            path = [System.IO.Path]::GetRelativePath($stage, $_.FullName).Replace('\', '/')
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
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive }
    Compress-Archive -LiteralPath $stage -DestinationPath $archive
    Write-Output "Candidate: $archive"
    Write-Output "Source: $source; dirty: $dirty; signed: false; broker execution: disabled"
} finally {
    Pop-Location
    foreach ($name in $previousBuildEnvironment.Keys) {
        [Environment]::SetEnvironmentVariable($name, $previousBuildEnvironment[$name], 'Process')
    }
}
