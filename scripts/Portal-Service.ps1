# Manage the portal as a background service that starts with Windows (a SYSTEM startup task).
#   .\scripts\Portal-Service.ps1 install     Build and install + start
#   .\scripts\Portal-Service.ps1 update      Rebuild after code changes and restart
#   .\scripts\Portal-Service.ps1 start | stop | restart | status
#   .\scripts\Portal-Service.ps1 uninstall   Stop and remove (saved passwords are kept; data is in Turso)
# Run in an Administrator PowerShell window. The portal is then at http://127.0.0.1:6001/ on this server.
param([Parameter(Mandatory = $true)][ValidateSet('install', 'update', 'start', 'stop', 'restart', 'status', 'uninstall')][string]$Action)
$ErrorActionPreference = 'Stop'
$TaskName = 'KG Mail Portal'
$project = Split-Path -Parent $PSScriptRoot
$state = Join-Path $env:ProgramData 'KGMailPortal'
$url = 'http://127.0.0.1:6001/'

function Assert-Admin {
    $identity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
    if (-not $identity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this in an Administrator PowerShell window.' }
}
# Through cmd so "task not found" on stderr is not a terminating error in Windows PowerShell 5.1.
function Test-Installed { cmd.exe /c "schtasks /Query /TN `"$TaskName`" >nul 2>&1"; return $LASTEXITCODE -eq 0 }
function Stop-Portal {
    if (Test-Installed) { cmd.exe /c "schtasks /End /TN `"$TaskName`" >nul 2>&1" }
    $pidFile = Join-Path $state 'portal.pid'
    if (Test-Path -LiteralPath $pidFile) {
        $process = Get-Process -Id ([int](Get-Content -LiteralPath $pidFile)) -ErrorAction SilentlyContinue
        if ($process -and $process.ProcessName -eq 'node') { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue; $process.WaitForExit(15000) | Out-Null }
        Remove-Item -LiteralPath $pidFile -Force
    }
}
function Start-Portal {
    cmd.exe /c "schtasks /Run /TN `"$TaskName`" >nul 2>&1"
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 2
        try { Invoke-WebRequest "${url}api/auth/session" -UseBasicParsing -TimeoutSec 3 | Out-Null; Write-Host "Portal is running: $url"; return } catch { }
    }
    Write-Warning "The portal did not answer yet. Check the logs in $project\logs."
}
function Build-Portal {
    Push-Location $project
    try {
        & npm.cmd install --no-fund --no-audit; if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
        & npm.cmd run build; if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
    } finally { Pop-Location }
}
function Register-Portal {
    $node = (Get-Command node.exe -ErrorAction Stop).Source
    $run = Join-Path $PSScriptRoot 'Run-Portal.ps1'
    $arguments = [Security.SecurityElement]::Escape("-NoProfile -ExecutionPolicy Bypass -File `"$run`" -Node `"$node`"")
    $xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>KG Mail Portal: React + Node.js mailer and daily schedules ($url, this server only).</Description></RegistrationInfo>
  <Triggers><BootTrigger><Enabled>true</Enabled></BootTrigger></Triggers>
  <Principals><Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>powershell.exe</Command><Arguments>$arguments</Arguments><WorkingDirectory>$([Security.SecurityElement]::Escape($project))</WorkingDirectory></Exec></Actions>
</Task>
"@
    $file = Join-Path $env:TEMP 'kg-mail-portal-task.xml'
    Set-Content -LiteralPath $file -Value $xml -Encoding Unicode
    try { schtasks.exe /Create /TN $TaskName /XML $file /F | Out-Null; if ($LASTEXITCODE -ne 0) { throw 'Could not register the startup task.' } }
    finally { Remove-Item -LiteralPath $file -Force }
}

Assert-Admin
switch ($Action) {
    'install'   { Build-Portal; Stop-Portal; Register-Portal; Start-Portal
                  foreach ($name in 'SMTP_PASSWORD', 'TURSO_AUTH_TOKEN') { if (-not (Test-Path (Join-Path $state "secrets\$name.bin"))) { Write-Warning "$name is not saved yet: run .\scripts\Set-Secret.ps1 $name, then restart." } } }
    'update'    { Build-Portal; Stop-Portal; Start-Portal }
    'start'     { Start-Portal }
    'stop'      { Stop-Portal; Write-Host 'Portal stopped.' }
    'restart'   { Stop-Portal; Start-Portal }
    'status'    {
        if (-not (Test-Installed)) { Write-Host 'Not installed.'; break }
        try {
            Invoke-RestMethod "${url}api/auth/session" -TimeoutSec 3 | Out-Null; Write-Host "Running at $url"
            # The mail check result is in the newest log (the API itself requires sign-in).
            $log = Get-ChildItem (Join-Path $project "logs") -Filter "portal-*.log" | Where-Object { $_.Name -notlike "*.err.log" } | Sort-Object LastWriteTime | Select-Object -Last 1
            if ($log) { Select-String -LiteralPath $log.FullName -Pattern '^\[(mail|users)\]' | Select-Object -Last 2 | ForEach-Object { Write-Host $_.Line } }
        }
        catch { Write-Host "Installed but not answering. Logs: $project\logs" }
    }
    'uninstall' { Stop-Portal; if (Test-Installed) { schtasks.exe /Delete /TN $TaskName /F | Out-Null }; Write-Host 'Service removed. Saved passwords were kept; data is in Turso.' }
}
