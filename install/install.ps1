param(
  [ValidateSet('codex','chatgpt','claude')][string]$Provider,
  [switch]$Yes,
  [ValidateSet('install','skip')][string]$Docker,
  [string]$Connectors
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo = '__REPO__'
$HomeDir = if ($env:MOOOTION_HOME) { $env:MOOOTION_HOME } else { Join-Path $env:USERPROFILE 'Moootion' }
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ('moootion-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  $Zip = Join-Path $Tmp 'moootion.zip'
  Invoke-WebRequest "https://github.com/$Repo/releases/latest/download/moootion-win-x64.zip" -OutFile $Zip
  & tar -xf $Zip -C $Tmp
  if ($LASTEXITCODE -ne 0) { throw 'Не удалось распаковать релиз' }
  $Payload = Join-Path $Tmp 'Moootion'
  if (-not (Test-Path (Join-Path $Payload 'tools\setup.mjs'))) { throw 'В релизе нет нового мастера установки tools/setup.mjs' }
  if (-not (Test-Path (Join-Path $Payload '.runtime\node\node.exe'))) { throw 'В релизе отсутствует Node.js' }
  New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
  foreach ($item in 'server','studio','runtime','library','templates','tools','install','rules','docs','node_modules','package.json','package-lock.json','vite.config.ts','tsconfig.json','README.md','NOTICE.md','moootion.cmd','.sdk-version') {
    $p = Join-Path $HomeDir $item
    if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force }
  }
  # Include dot directories; preserve the user's separately installed .runtime/agents.
  Get-ChildItem -LiteralPath $Payload -Force | Copy-Item -Destination $HomeDir -Recurse -Force
  New-Item -ItemType Directory -Force -Path (Join-Path $HomeDir 'projects') | Out-Null
} finally { Remove-Item -LiteralPath $Tmp -Recurse -Force -ErrorAction SilentlyContinue }
$UserPath = [Environment]::GetEnvironmentVariable('PATH','User')
if (-not ($UserPath -split ';' | Where-Object { $_ -eq $HomeDir })) { [Environment]::SetEnvironmentVariable('PATH', "$UserPath;$HomeDir", 'User') }
$Shell = New-Object -ComObject WScript.Shell
$Lnk = $Shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Moootion.lnk'))
$Lnk.TargetPath = Join-Path $HomeDir 'moootion.cmd'
$Lnk.WorkingDirectory = $HomeDir
$Lnk.Save()
$SetupArgs = @()
if ($Provider) { $SetupArgs += "--provider=$Provider" }
if ($Yes) { $SetupArgs += '--yes' }
if ($Docker) { $SetupArgs += "--docker=$Docker" }
if ($Connectors) { $SetupArgs += "--connectors=$Connectors" }
Push-Location $HomeDir
try {
  & (Join-Path $HomeDir '.runtime\node\node.exe') tools/setup.mjs @SetupArgs
  $Result = $LASTEXITCODE
} finally { Pop-Location }
if ($Result -eq 0) { Write-Host 'Установка проверена. Запуск: moootion или ярлык.' }
elseif ($Result -eq 2) { Write-Host 'Файлы установлены; завершите отмеченные подключения: moootion setup.' }
else { throw 'Мастер установки завершился с ошибкой. Повторить: moootion setup.' }
# Do not exit the caller's interactive PowerShell session when invoked with irm | iex.
$global:LASTEXITCODE = $Result
