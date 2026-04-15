$port = 3001

# 1) Try .env (backend root) so npm scripts can target the same PORT
$envFile = Join-Path $PSScriptRoot "..\.env"
if (Test-Path $envFile) {
  $portLine = Get-Content $envFile | Where-Object { $_ -match '^\s*PORT\s*=\s*\d+\s*$' } | Select-Object -First 1
  if ($portLine) {
    $rawPort = ($portLine -split '=', 2)[1].Trim()
    if ($rawPort -match '^\d+$') {
      $port = [int]$rawPort
    }
  }
}

# 2) Environment variable overrides .env when explicitly provided
if ($env:PORT -and $env:PORT -match '^\d+$') {
  $port = [int]$env:PORT
}

$conn = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($null -eq $conn) {
  Write-Host "Aucun process sur le port $port"
  exit 0
}

$owningPid = $conn.OwningProcess
Write-Host "Port $port occupé (PID $owningPid). Arrêt..."
Stop-Process -Id $owningPid -Force
Start-Sleep -Seconds 1
Write-Host "OK"

