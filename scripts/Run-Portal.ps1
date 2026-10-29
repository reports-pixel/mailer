# Launcher used by the "KG Mail Portal" startup task (runs as SYSTEM). Not meant to be run by hand.
param([Parameter(Mandatory = $true)][string]$Node)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$state = Join-Path $env:ProgramData 'KGMailPortal'
New-Item -ItemType Directory -Force $state | Out-Null

# Passwords saved by Set-Secret.ps1 (encrypted for this machine) become environment variables for Node.
Add-Type -AssemblyName System.Security
foreach ($secret in Get-ChildItem (Join-Path $state 'secrets') -Filter *.bin -ErrorAction SilentlyContinue) {
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($secret.FullName), $null, 'LocalMachine')
    [Environment]::SetEnvironmentVariable($secret.BaseName, [Text.Encoding]::UTF8.GetString($bytes), 'Process')
}

$logs = Join-Path $project 'logs'
New-Item -ItemType Directory -Force $logs | Out-Null

# Keep the portal running: if Node exits, start it again after 10 seconds.
while ($true) {
    $stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
    $process = Start-Process -FilePath $Node -ArgumentList '--env-file-if-exists=.env', 'server/index.js' -WorkingDirectory $project -NoNewWindow -PassThru `
        -RedirectStandardOutput (Join-Path $logs "portal-$stamp.log") -RedirectStandardError (Join-Path $logs "portal-$stamp.err.log")
    Set-Content -LiteralPath (Join-Path $state 'portal.pid') -Value $process.Id
    $process.WaitForExit()
    Start-Sleep -Seconds 10
}
