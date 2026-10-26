# Установка (и обновление) студии Moootion на Windows одной командой в PowerShell:
#   irm https://github.com/__REPO__/releases/latest/download/install.ps1 | iex
# Ставит студию в %USERPROFILE%\Moootion (свой Node внутри, без прав администратора). При обновлении заменяется
# только код: проекты, рендеры и настройки остаются на месте и никуда не отправляются.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Repo = '__REPO__'
$HomeDir = if ($env:MOOOTION_HOME) { $env:MOOOTION_HOME } else { Join-Path $env:USERPROFILE 'Moootion' }
function Say($t) { Write-Host $t -ForegroundColor White }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Say 'Совет: поставьте Git (winget install Git.Git) - без него не будут сохраняться версии проектов.'
}

Say 'Скачиваю Moootion (win-x64)...'
$Tmp = Join-Path ([IO.Path]::GetTempPath()) ("moootion-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  $Zip = Join-Path $Tmp 'moootion.zip'
  Invoke-WebRequest "https://github.com/$Repo/releases/latest/download/moootion-win-x64.zip" -OutFile $Zip
  tar -xf $Zip -C $Tmp

  Say "Ставлю в $HomeDir..."
  New-Item -ItemType Directory -Force -Path $HomeDir | Out-Null
  # only the code is replaced; the user's data stays
  foreach ($item in 'server','studio','runtime','library','templates','tools','node_modules','.runtime','package.json',
    'package-lock.json','vite.config.ts','tsconfig.json','README.md','NOTICE.md','moootion.cmd','.sdk-version') {
    $p = Join-Path $HomeDir $item
    if (Test-Path $p) { Remove-Item -Recurse -Force $p }
  }
  Copy-Item -Recurse -Force (Join-Path $Tmp 'Moootion\*') $HomeDir
  New-Item -ItemType Directory -Force -Path (Join-Path $HomeDir 'projects') | Out-Null
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

Set-Location $HomeDir
$Node = Join-Path $HomeDir '.runtime\node\node.exe'
$Npm = Join-Path $HomeDir '.runtime\node\node_modules\npm\bin\npm-cli.js'
$Sdk = (Get-Content (Join-Path $HomeDir '.sdk-version')).Trim()
Say "Ставлю агента Claude (Claude Agent SDK $Sdk) из npm..."
$env:PATH = (Join-Path $HomeDir '.runtime\node') + ';' + $env:PATH
& $Node $Npm install --no-save --no-audit --no-fund --loglevel=error "@anthropic-ai/claude-agent-sdk@$Sdk"
$Claude = Join-Path $HomeDir 'node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe'

# the `moootion` command (user PATH) and a Desktop shortcut
$UserPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if (-not ($UserPath -split ';' | Where-Object { $_ -eq $HomeDir })) {
  [Environment]::SetEnvironmentVariable('PATH', "$UserPath;$HomeDir", 'User')
}
$Shell = New-Object -ComObject WScript.Shell
$Lnk = $Shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Moootion.lnk'))
$Lnk.TargetPath = Join-Path $HomeDir 'moootion.cmd'
$Lnk.WorkingDirectory = $HomeDir
$Lnk.Save()

# Claude: the studio works through your Claude subscription (Pro or Max)
$status = & $Claude auth status --json 2>$null | Out-String
if ($status -notmatch '"loggedIn":\s*true') {
  Say 'Войдите в Claude - откроется браузер (нужна подписка Pro или Max):'
  & $Claude auth login
}

Say 'Готово. Запуск: ярлык Moootion на рабочем столе или команда moootion в новом окне терминала.'
Say 'Figma и Magnific подключаются в claude.ai -> Настройки -> Коннекторы.'
& (Join-Path $HomeDir 'moootion.cmd') start
