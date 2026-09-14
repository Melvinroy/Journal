param(
  [Parameter(Mandatory = $true)][string]$EnvFile,
  [string]$TaskName = 'Brontide EOD Update',
  [string]$LogPath
)

$ErrorActionPreference = 'Stop'
$serviceRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-scheduled-update.ps1'
$resolvedEnv = (Resolve-Path -LiteralPath $EnvFile).Path
if (-not $LogPath) {
  $LogPath = Join-Path (Split-Path -Parent $resolvedEnv) 'data\brontide-eod-update.log'
}
if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  throw "Scheduled Task '$TaskName' already exists; inspect it instead of overwriting it."
}

$argument = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$runner`" -EnvFile `"$resolvedEnv`" -LogPath `"$LogPath`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument -WorkingDirectory $serviceRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 6)
$principal = New-ScheduledTaskPrincipal -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
Get-ScheduledTask -TaskName $TaskName | Select-Object TaskName,State,@{Name='UserId';Expression={$_.Principal.UserId}},@{Name='RunLevel';Expression={$_.Principal.RunLevel}}
