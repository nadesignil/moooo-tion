$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$candidates=@(
 (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe'),
 (Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe')
)
$docker=$candidates | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
if(-not $docker){$docker='docker.exe'}
$hostUri='npipe:////./pipe/docker_engine'
$osType=& $docker --host $hostUri info --format '{{.OSType}}'
if($LASTEXITCODE -ne 0 -or $osType -ne 'linux'){throw 'Start Docker Desktop with Linux containers first'}
& $docker --host $hostUri build --pull --tag moootion-executor:1 (Join-Path $root 'install\executor')
if($LASTEXITCODE -ne 0){throw 'Executor image build failed'}
& $docker --host $hostUri image inspect moootion-executor:1 --format '{{.Id}}'
if($LASTEXITCODE -ne 0){throw 'Cannot inspect executor image'}

# Run the real isolation checks after building. No model/API calls or paid media generation.
$previousIntegration=$env:MOOOTION_SANDBOX_INTEGRATION
Push-Location $root
try {
 $env:MOOOTION_SANDBOX_INTEGRATION='1'
 & node --import tsx --test server/sandbox-executor.test.ts
 if($LASTEXITCODE -ne 0){throw 'Executor integration checks failed'}
} finally {
 $env:MOOOTION_SANDBOX_INTEGRATION=$previousIntegration
 Pop-Location
}
