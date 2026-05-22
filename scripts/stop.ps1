$ErrorActionPreference = "Stop"

$pidPath = Join-Path $PSScriptRoot "..\.server.pid"

if (-not (Test-Path $pidPath)) {
  Write-Host "No .server.pid file found."
  exit 0
}

$serverPid = Get-Content -LiteralPath $pidPath -ErrorAction SilentlyContinue
if (-not $serverPid) {
  Write-Host "No server PID recorded."
  exit 0
}

Stop-Process -Id ([int]$serverPid) -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $pidPath -ErrorAction SilentlyContinue
Write-Host "Stopped server process $serverPid."
