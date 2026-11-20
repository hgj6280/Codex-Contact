$ErrorActionPreference = 'Stop'
$lock = Join-Path $PSScriptRoot 'runtime\run.lock'
if (-not (Test-Path $lock)) { Write-Host 'Service is not running.'; exit 0 }
$servicePid = [int](Get-Content $lock -Raw)
if ($servicePid -lt 1) { throw 'Invalid service PID.' }
$process = Get-CimInstance Win32_Process -Filter "ProcessId=$servicePid"
if (-not $process) { Remove-Item -LiteralPath $lock; exit 0 }
$expected = Join-Path $PSScriptRoot 'run.mjs'
if ($process.Name -ne 'node.exe' -or -not $process.CommandLine.Contains($expected)) { throw 'PID belongs to another program. Refusing to stop it; verify the stale lock manually.' }
& taskkill.exe /PID $servicePid /T /F
if ($LASTEXITCODE -ne 0) { throw 'Failed to stop the QQ service.' }
Remove-Item -LiteralPath $lock -ErrorAction SilentlyContinue
