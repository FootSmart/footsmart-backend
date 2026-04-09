$port = 3001
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

