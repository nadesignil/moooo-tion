@echo off
chcp 65001 >nul
setlocal
set "DIR=%~dp0"
set "NODE=%DIR%.runtime\node\node.exe"
if not exist "%NODE%" set "NODE=node"
cd /d "%DIR%"
if "%~1"=="" goto start
if /i "%~1"=="version" goto version
if /i "%~1"=="--version" goto version
if /i "%~1"=="-v" goto version
if /i "%~1"=="start" goto start
if /i "%~1"=="setup" goto setup
if /i "%~1"=="login" goto login
if /i "%~1"=="doctor" goto doctor
if /i "%~1"=="update" goto update
echo Commands: moootion [start^|setup^|login^|doctor^|update^|version]
exit /b 1
:version
"%NODE%" -p "require('./package.json').version"
exit /b %ERRORLEVEL%
:start
"%NODE%" tools\start.mjs %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
:setup
"%NODE%" tools\setup.mjs %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
:login
"%NODE%" tools\setup.mjs --login %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
:doctor
"%NODE%" tools\setup.mjs --check %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
:update
set "MOOOTION_HOME=%DIR%"
powershell -NoProfile -Command "irm https://github.com/__REPO__/releases/latest/download/install.ps1 | iex; exit $LASTEXITCODE"
exit /b %ERRORLEVEL%
