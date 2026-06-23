param(
  [int]$Port = 5070
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$serverScript = Join-Path $scriptDir "server.mjs"
$healthUrl = "http://127.0.0.1:$Port/health"

# 先探活，避免重复拉起多个服务窗口。
$isRunning = $false
try {
  Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
  $isRunning = $true
} catch {
  $isRunning = $false
}

if (-not $isRunning) {
  $command = @(
    "Set-Location '$scriptDir'",
    "`$env:PROGRESS_BOARD_PORT = '$Port'",
    "node '$serverScript'"
  ) -join "; "

  Start-Process powershell -ArgumentList "-NoExit", "-Command", $command
  Start-Sleep -Seconds 2
}

Start-Process "http://127.0.0.1:$Port"
