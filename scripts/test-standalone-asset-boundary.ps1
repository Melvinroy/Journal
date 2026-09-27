$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$parent = [IO.Path]::GetFullPath((Join-Path $repoRoot 'output/modular-candidate'))
if ((Test-Path -LiteralPath $parent) -and
    ((Get-Item -LiteralPath $parent -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Fixture parent must not be a reparse point.'
}
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$root = Join-Path $parent ("asset-boundary-fixture-" + [guid]::NewGuid().ToString('N'))
$full = [IO.Path]::GetFullPath($root)
if (-not $full.StartsWith($parent.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Fixture escaped the isolated output directory.'
}
$checker = Join-Path $PSScriptRoot 'assert-standalone-asset-boundary.ps1'
$page = Join-Path $root 'index.html'
$chunk = Join-Path $root 'app.js'
$style = Join-Path $root 'app.css'
$data = Join-Path $root 'route.json'
$hiddenFile = Join-Path $root 'hidden.js'
$hiddenDirectory = Join-Path $root 'hidden-assets'
$hiddenNestedFile = Join-Path $hiddenDirectory 'nested.js'
New-Item -ItemType Directory -Path $root | Out-Null
try {
    Set-Content -LiteralPath $page -Value '<main>Local Trading and Journal</main>' -Encoding utf8
    & $checker -AssetRoot $root | Out-Null
    foreach ($signature in @('@supabase/supabase-js', 'NEXT_PUBLIC_SUPABASE_URL',
                             'onAuthStateChange')) {
        Set-Content -LiteralPath $chunk -Value "export const marker = '$signature';" -Encoding utf8
        $rejected = $false
        try { & $checker -AssetRoot $root | Out-Null }
        catch {
            if ($_.Exception.Message -notlike '*contains cloud-auth code*') { throw }
            $rejected = $true
        }
        if (-not $rejected) { throw 'A cloud-auth fixture was accepted.' }
    }
    Remove-Item -LiteralPath $chunk
    foreach ($privateMarker in @('abcdefghijklmnop.supabase.co',
                                'sb_publishable_012345678901234567890',
                                'C:\Users\artificial-fixture', 'paper-lifecycle.sqlite3')) {
        Set-Content -LiteralPath $data -Value $privateMarker -Encoding utf8
        $rejected = $false
        try { & $checker -AssetRoot $root | Out-Null }
        catch {
            if ($_.Exception.Message -notlike '*cloud configuration or a private-path marker*') { throw }
            $rejected = $true
        }
        if (-not $rejected) { throw 'A private-configuration fixture was accepted.' }
    }
    Remove-Item -LiteralPath $data
    foreach ($textAsset in @($style, $data)) {
        Set-Content -LiteralPath $textAsset -Value 'onAuthStateChange' -Encoding utf8
        $rejected = $false
        try { & $checker -AssetRoot $root | Out-Null }
        catch {
            if ($_.Exception.Message -notlike '*contains cloud-auth code*') { throw }
            $rejected = $true
        }
        if (-not $rejected) { throw 'A cloud-auth text asset was accepted.' }
        Remove-Item -LiteralPath $textAsset
    }
    Set-Content -LiteralPath $hiddenFile -Value 'onAuthStateChange' -Encoding utf8
    (Get-Item -LiteralPath $hiddenFile).Attributes = [IO.FileAttributes]::Hidden
    $rejected = $false
    try { & $checker -AssetRoot $root | Out-Null }
    catch {
        if ($_.Exception.Message -notlike '*contains cloud-auth code*') { throw }
        $rejected = $true
    }
    if (-not $rejected) { throw 'A hidden cloud-auth file was accepted.' }
    Remove-Item -LiteralPath $hiddenFile -Force

    New-Item -ItemType Directory -Path $hiddenDirectory | Out-Null
    Set-Content -LiteralPath $hiddenNestedFile -Value 'onAuthStateChange' -Encoding utf8
    (Get-Item -LiteralPath $hiddenDirectory).Attributes = [IO.FileAttributes]::Hidden
    $rejected = $false
    try { & $checker -AssetRoot $root | Out-Null }
    catch {
        if ($_.Exception.Message -notlike '*contains cloud-auth code*') { throw }
        $rejected = $true
    }
    if (-not $rejected) { throw 'A hidden cloud-auth directory was accepted.' }
    Remove-Item -LiteralPath $hiddenNestedFile -Force
    Remove-Item -LiteralPath $hiddenDirectory -Force
    Remove-Item -LiteralPath $page
    $rejectedEmpty = $false
    try { & $checker -AssetRoot $root | Out-Null }
    catch {
        if ($_.Exception.Message -notlike '*assets are missing*') { throw }
        $rejectedEmpty = $true
    }
    if (-not $rejectedEmpty) { throw 'An empty asset export was accepted.' }
    Write-Output 'Standalone asset-boundary fixtures passed.'
} finally {
    foreach ($file in @($chunk, $style, $data, $hiddenFile, $hiddenNestedFile, $page)) {
        if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
    if (Test-Path -LiteralPath $hiddenDirectory) {
        Remove-Item -LiteralPath $hiddenDirectory -Force
    }
    if (@(Get-ChildItem -LiteralPath $root -Force).Count -ne 0) {
        throw 'Fixture contains unexpected files; inspect before cleanup.'
    }
    Remove-Item -LiteralPath $root
}
