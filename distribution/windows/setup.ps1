param([string]$ConfigFile = '', [switch]$InstallDependencies, [switch]$AutoStart)
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
function CheckExit($name) { if ($LASTEXITCODE -ne 0) { throw "$name failed ($LASTEXITCODE)" } }
if ($InstallDependencies) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'Install Node.js 24 LTS and Docker Desktop first: winget is unavailable.' }
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) { winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements; CheckExit 'Node install' }
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { winget install --id Docker.DockerDesktop -e --accept-package-agreements --accept-source-agreements; CheckExit 'Docker install' }
  $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 24+ required. Run setup.ps1 -InstallDependencies or install Node.js.' }
& node -e 'if(Number(process.versions.node.split(".")[0])<24)process.exit(1)'; CheckExit 'Node 24 check'
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker Desktop required. Enable WSL2 and start Linux containers, then rerun setup.' }
& docker info --format '{{.OSType}}' | Out-Null; CheckExit 'Docker readiness (start Docker Desktop first)'
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
Push-Location $root
try {
  & $npm ci --omit=dev; CheckExit 'package dependencies'
  $npmRoot = (& $npm root -g).Trim(); CheckExit 'npm global root'
  $cli = Join-Path $npmRoot '@openai\codex\bin\codex.js'
  if (-not (Test-Path $cli)) { & $npm install -g @openai/codex; CheckExit 'Codex install' }
  if (-not (Test-Path $cli)) { throw 'Codex CLI launcher not found after installation.' }
  $params = @('initialize.mjs','--cli',$cli)
  if ($ConfigFile) { $params += @('--config',(Resolve-Path $ConfigFile).Path) }
  & node @params; CheckExit 'initialize'
  & docker compose -p qq-friend-windows pull; CheckExit 'NapCat download'
  & docker compose -p qq-friend-windows up -d; CheckExit 'NapCat start'
  if ($AutoStart) {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $root 'start.ps1') + '"') -WorkingDirectory $root
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name)
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName 'QQFriendWindows' -Action $action -Trigger $trigger -Settings $settings -Description 'Local QQ friend hub' -Force | Out-Null
  }
  Write-Host 'Installed. Run node with the installed CLI launcher and login once:'
  Write-Host ('node "' + $cli + '" login')
  Write-Host 'Then run Start.cmd. Use Login.cmd to open the QQ QR login page.'
} finally { Pop-Location }
