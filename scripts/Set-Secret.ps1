# Saves a password encrypted for this machine (Windows DPAPI). Run in an Administrator PowerShell window.
#   .\scripts\Set-Secret.ps1 SMTP_PASSWORD     Gmail app password
#   .\scripts\Set-Secret.ps1 TURSO_AUTH_TOKEN  Turso database token
#   .\scripts\Set-Secret.ps1 ADMIN_PASSWORD    Portal sign-in password (default: admin)
#   .\scripts\Set-Secret.ps1 SESSION_SECRET    Optional key for signing sign-in sessions
# Only SYSTEM and Administrators can read the saved files. Restart afterwards: .\scripts\Portal-Service.ps1 restart
param([Parameter(Mandatory = $true)][ValidateSet('SMTP_PASSWORD', 'TURSO_AUTH_TOKEN', 'ADMIN_PASSWORD', 'SESSION_SECRET')][string]$Name)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$secrets = Join-Path $env:ProgramData 'KGMailPortal\secrets'
New-Item -ItemType Directory -Force $secrets | Out-Null
icacls (Split-Path $secrets) /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null

$secure = Read-Host "$Name (input hidden)" -AsSecureString
$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer); $secure.Dispose() }
if (-not $plain) { throw 'Nothing entered; nothing was saved.' }
$protected = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($plain), $null, 'LocalMachine')
[IO.File]::WriteAllBytes((Join-Path $secrets "$Name.bin"), $protected)
Write-Host "Saved $Name. Now run: .\scripts\Portal-Service.ps1 restart"
