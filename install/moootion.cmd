@echo off
rem Moootion: запуск и обслуживание студии на Windows.
rem   moootion            запустить студию (откроется браузер)
rem   moootion login      войти в Claude (подписка Pro или Max)
rem   moootion update     обновить студию (проекты не трогаются)
rem   moootion doctor     проверить, всё ли на месте
chcp 65001 >nul
setlocal
set "DIR=%~dp0"
set "NODE=%DIR%.runtime\node\node.exe"
set "CLAUDE=%DIR%node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe"
set "CMD=%~1"
if "%CMD%"=="" set "CMD=start"

if /i "%CMD%"=="start" (
  cd /d "%DIR%"
  "%NODE%" tools\start.mjs
  goto :eof
)
if /i "%CMD%"=="login" (
  "%CLAUDE%" auth login
  goto :eof
)
if /i "%CMD%"=="update" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/__REPO__/releases/latest/download/install.ps1 | iex"
  goto :eof
)
if /i "%CMD%"=="doctor" (
  echo Студия: %DIR%
  "%NODE%" --version
  where git >nul 2>nul && git --version || echo git: нет - версии проектов не будут сохраняться ^(winget install Git.Git^)
  if exist "%CLAUDE%" ( "%CLAUDE%" auth status --text ) else ( echo Claude: агент не установлен - запустите: moootion update )
  cd /d "%DIR%"
  "%NODE%" node_modules\tsx\dist\cli.mjs tools\smoke.ts
  goto :eof
)
echo Команды: moootion [start^|login^|update^|doctor]
