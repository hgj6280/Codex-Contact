$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Test-Path 'launch.json')) { throw 'Run Install.cmd first.' }
& docker compose -p qq-friend-windows up -d
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop (Linux containers), then retry.' }
& node run.mjs
if ($LASTEXITCODE -ne 0) { throw 'QQ service exited. Read runtime/logs and rerun Start.cmd.' }
