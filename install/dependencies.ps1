param([ValidateSet('git','docker')][string]$Component)
$ErrorActionPreference = 'Stop'
if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'Установите App Installer (winget) через Microsoft Store и повторите moootion setup.' }
$Package = if ($Component -eq 'git') { 'Git.Git' } else { 'Docker.DockerDesktop' }
# Keep vendor agreements and OS elevation in their normal interactive installers.
& winget install --exact --id $Package --interactive
if ($LASTEXITCODE -ne 0) { throw "Не удалось установить $Package" }
if ($Component -eq 'docker') {
  $App = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $App) { Start-Process $App }
  Write-Host 'Завершите настройку Docker Desktop и WSL 2, при необходимости перезагрузите компьютер; затем moootion setup.'
} else { Write-Host 'Перезапустите терминал, чтобы Git появился в PATH, затем moootion setup.' }
