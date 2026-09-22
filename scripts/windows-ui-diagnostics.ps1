[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int]$RootProcessId,
    [Parameter(Mandatory = $true)]
    [ValidateSet('before-tests', 'first-failure')]
    [string]$Phase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$diagnosticErrors = [System.Collections.Generic.List[string]]::new()
$result = [ordered]@{
    schemaVersion = 1
    capturedAtUtc = [DateTime]::UtcNow.ToString('o')
    phase = $Phase
    rootProcessId = $RootProcessId
    memory = $null
    processes = @()
    tcp = $null
    dynamicTcpPorts = @()
    localhostHead = $null
}

try {
    $memory = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory -Property AvailableBytes, CommittedBytes, CommitLimit
    $result.memory = [ordered]@{
        availableBytes = [uint64]$memory.AvailableBytes
        committedBytes = [uint64]$memory.CommittedBytes
        commitLimitBytes = [uint64]$memory.CommitLimit
    }
} catch { $diagnosticErrors.Add('memory_snapshot_unavailable') }

$ownedIds = [System.Collections.Generic.HashSet[int]]::new()
try {
    # Select only identity fields: never collect executable paths or command lines.
    $processes = @(Get-CimInstance -ClassName Win32_Process -Property ProcessId, ParentProcessId, Name)
    if (-not ($processes | Where-Object { $_.ProcessId -eq $RootProcessId })) {
        $diagnosticErrors.Add('root_process_not_present')
    } else {
        $null = $ownedIds.Add($RootProcessId)
        do {
            $added = $false
            foreach ($process in $processes) {
                if ($ownedIds.Contains([int]$process.ParentProcessId) -and $ownedIds.Add([int]$process.ProcessId)) { $added = $true }
            }
        } while ($added)
        $result.processes = @(
            foreach ($process in $processes | Where-Object { $ownedIds.Contains([int]$_.ProcessId) } | Sort-Object ProcessId) {
                try {
                    $live = Get-Process -Id $process.ProcessId
                    [ordered]@{
                        processId = [int]$process.ProcessId
                        parentProcessId = [int]$process.ParentProcessId
                        name = [string]$process.Name
                        handleCount = [int]$live.HandleCount
                        workingSetBytes = [long]$live.WorkingSet64
                        privateMemoryBytes = [long]$live.PrivateMemorySize64
                    }
                } catch { $diagnosticErrors.Add('owned_process_disappeared_or_unavailable') }
            }
        )
    }
} catch { $diagnosticErrors.Add('process_snapshot_unavailable') }

function Get-StateCounts($Connections) {
    @($Connections | Group-Object -Property State | Sort-Object Name | ForEach-Object {
        [ordered]@{ state = [string]$_.Name; count = [int]$_.Count }
    })
}

try {
    $connections = @(Get-NetTCPConnection)
    $ownedConnections = @($connections | Where-Object { $ownedIds.Contains([int]$_.OwningProcess) })
    $loopback = @('127.0.0.1', '::1', '::ffff:127.0.0.1')
    $previewConnections = @($connections | Where-Object {
        ($_.LocalPort -eq 3107 -and $_.LocalAddress -in $loopback) -or
        ($_.RemotePort -eq 3107 -and $_.RemoteAddress -in $loopback)
    })
    # Publish counts only, not remote addresses, ports, or unrelated process identities.
    $result.tcp = [ordered]@{
        systemByState = @(Get-StateCounts $connections)
        ownedByState = @(Get-StateCounts $ownedConnections)
        loopback3107ByState = @(Get-StateCounts $previewConnections)
    }
} catch { $diagnosticErrors.Add('tcp_snapshot_unavailable') }

foreach ($family in @('ipv4', 'ipv6')) {
    try {
        $rangeOutput = & netsh interface $family show dynamicport tcp 2>$null
        if ($LASTEXITCODE -ne 0) { throw 'range unavailable' }
        # Parse numeric values only; do not emit localized command output or errors.
        $values = @($rangeOutput | ForEach-Object {
            if ($_ -match '^\s*[^:]+:\s*(\d+)\s*$') { [int]$Matches[1] }
        })
        if ($values.Count -ne 2 -or $values[0] -lt 1 -or $values[1] -lt 1 -or ($values[0] + $values[1]) -gt 65536) { throw 'range invalid' }
        $result.dynamicTcpPorts += [ordered]@{ family = $family; startPort = $values[0]; portCount = $values[1] }
    } catch { $diagnosticErrors.Add("dynamic_tcp_${family}_unavailable") }
}

if ($Phase -eq 'first-failure') {
    $handler = $null
    $client = $null
    $request = $null
    $response = $null
    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        Add-Type -AssemblyName System.Net.Http
        $handler = [System.Net.Http.HttpClientHandler]::new()
        $handler.AllowAutoRedirect = $false
        $handler.UseProxy = $false
        $handler.UseDefaultCredentials = $false
        $client = [System.Net.Http.HttpClient]::new($handler)
        $client.Timeout = [TimeSpan]::FromSeconds(3)
        $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Head, 'http://127.0.0.1:3107/')
        $response = $client.SendAsync($request, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
        $result.localhostHead = [ordered]@{ outcome = 'response'; status = [int]$response.StatusCode; elapsedMs = $timer.ElapsedMilliseconds }
    } catch {
        $result.localhostHead = [ordered]@{ outcome = 'unavailable'; status = $null; elapsedMs = $timer.ElapsedMilliseconds }
        $diagnosticErrors.Add('localhost_head_unavailable')
    } finally {
        $timer.Stop()
        if ($response) { $response.Dispose() }
        if ($request) { $request.Dispose() }
        if ($client) { $client.Dispose() } elseif ($handler) { $handler.Dispose() }
    }
}

$result.errors = @($diagnosticErrors | Select-Object -Unique)
$result | ConvertTo-Json -Depth 6 -Compress
