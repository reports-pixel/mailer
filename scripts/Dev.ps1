# Runs the portal in development mode (live reload) from a terminal, e.g. VS Code:
#   .\scripts\Dev.ps1            -> http://127.0.0.1:6003/
#   .\scripts\Dev.ps1 -Port 6005
#   .\scripts\Dev.ps1 -Lan       -> also open to other PCs, e.g. http://<this-pc-ip>:6003/ (sign-in required)
# Uses port 6003 so it does not clash with the Windows service on 6001. Stop with Ctrl+C.
# Secrets come from the encrypted store (needs an Administrator terminal) or, if that cannot be read, from .env.local.
param([int]$Port = 6003, [switch]$Lan)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
Set-Location $project

$loaded = @()
$secrets = Join-Path $env:ProgramData 'KGMailPortal\secrets'
try {
    Add-Type -AssemblyName System.Security
    foreach ($secret in Get-ChildItem $secrets -Filter *.bin -ErrorAction Stop) {
        $bytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($secret.FullName), $null, 'LocalMachine')
        [Environment]::SetEnvironmentVariable($secret.BaseName, [Text.Encoding]::UTF8.GetString($bytes), 'Process')
        $loaded += $secret.BaseName
    }
} catch { }
if ($loaded) { Write-Host "Secrets loaded: $($loaded -join ', ')" }
elseif (Test-Path (Join-Path $project '.env.local')) { Write-Host 'Encrypted secrets not readable here; using .env.local.' }
else { Write-Warning 'No secrets: open the terminal as Administrator, or create .env.local with TURSO_AUTH_TOKEN=... and SMTP_PASSWORD=... (git-ignored).' }

if (-not (Test-Path (Join-Path $project 'node_modules'))) { & npm.cmd install --no-fund --no-audit }
$env:PORT = "$Port"
# The page reloads by itself when React files change; restart this script (Ctrl+C, then run again) after changing server/ files.
[string[]]$envFiles = @(@('.env', '.env.local') | Where-Object { Test-Path (Join-Path $project $_) } | ForEach-Object { "--env-file=$_" })
if ($Lan) {
    $env:HOST = '0.0.0.0'; $env:LOCAL_ONLY = 'false'
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { "http://$($_.IPAddress):$Port/" }
    Write-Host "Starting on http://127.0.0.1:$Port/ and on the network: $($ips -join ', ') (Ctrl+C to stop)"
} else { Write-Host "Starting on http://127.0.0.1:$Port/ (Ctrl+C to stop)" }
& node.exe ($envFiles + @('server/index.js', '--dev'))
