param(
  [Parameter(Mandatory = $true)][string]$EnvFile,
  [Parameter(Mandatory = $true)][string]$LogPath
)

$ErrorActionPreference = 'Stop'
$serviceRoot = Split-Path -Parent $PSScriptRoot
$python = Join-Path $serviceRoot '.venv\Scripts\python.exe'
$resolvedEnv = (Resolve-Path -LiteralPath $EnvFile).Path
$logDirectory = Split-Path -Parent $LogPath

if (-not (Test-Path -LiteralPath $python -PathType Leaf)) {
  throw "Scanner checkout EOD environment is not installed."
}
if (-not (Test-Path -LiteralPath $logDirectory -PathType Container)) {
  New-Item -ItemType Directory -Path $logDirectory | Out-Null
}

$started = [DateTimeOffset]::UtcNow.ToString('o')
"{`"event`":`"scheduled-run-started`",`"started_at`":`"$started`"}" | Out-File -LiteralPath $LogPath -Append -Encoding utf8
$exitCode = 1
try {
  & $python -m brontide_eod.cli scheduled-update --env-file $resolvedEnv 2>&1 | Out-File -LiteralPath $LogPath -Append -Encoding utf8
  $exitCode = $LASTEXITCODE
} finally {
  $completed = [DateTimeOffset]::UtcNow.ToString('o')
  "{`"event`":`"scheduled-run-finished`",`"completed_at`":`"$completed`",`"exit_code`":$exitCode}" | Out-File -LiteralPath $LogPath -Append -Encoding utf8
}
exit $exitCode
