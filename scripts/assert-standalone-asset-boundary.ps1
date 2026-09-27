# Reject known cloud-auth code in the exported desktop frontend. This is a
# release gate, not a proof that every possible secret or dependency is absent.
param([Parameter(Mandatory = $true)][string]$AssetRoot)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $AssetRoot).Path
if (-not (Test-Path -LiteralPath $root -PathType Container)) {
    throw 'Standalone asset root is unavailable.'
}
$assets = @(Get-ChildItem -LiteralPath $root -File -Recurse -Force -ErrorAction Stop |
    Where-Object { $_.Extension -in @('.js', '.mjs', '.html', '.css',
                                     '.json', '.map', '.txt', '.svg', '.xml') })
if ($assets.Count -eq 0) {
    throw 'Standalone assets are missing.'
}
$cloudAuthSignatures = @(
    '@supabase/supabase-js',
    'NEXT_PUBLIC_SUPABASE_URL',
    'onAuthStateChange'
)
foreach ($signature in $cloudAuthSignatures) {
    if (@($assets | Select-String -SimpleMatch -Pattern $signature -Quiet -ErrorAction Stop) -contains $true) {
        throw 'Standalone export contains cloud-auth code. Split the standalone and cloud entry points before packaging.'
    }
}
$privatePatterns = @(
    '[a-z0-9-]{16,}\.supabase\.co',
    'sb_publishable_[A-Za-z0-9_-]{20,}',
    'C:\\Users\\',
    'paper-lifecycle\.sqlite3'
)
foreach ($pattern in $privatePatterns) {
    if (@($assets | Select-String -Pattern $pattern -Quiet -ErrorAction Stop) -contains $true) {
        throw 'Standalone export contains cloud configuration or a private-path marker.'
    }
}
Write-Output 'Standalone cloud-auth and private-configuration boundary passed for known signatures.'
