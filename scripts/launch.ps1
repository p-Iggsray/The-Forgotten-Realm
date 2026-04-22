#Requires -Version 5.1
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

trap {
    $msg   = "ERROR: $($_.Exception.Message)"
    $trace = $_.ScriptStackTrace
    try { Write-Host "`n$msg" -ForegroundColor Red } catch {}
    try { Write-Host $trace  -ForegroundColor DarkGray } catch {}
    try {
        $logPath = "$env:TEMP\tfr-launch-error.txt"
        "$msg`n`n$trace" | Out-File $logPath -Force
        Write-Host "`nFull error saved to: $logPath" -ForegroundColor DarkGray
    } catch {}
    try { Read-Host "`nPress Enter to close" } catch {}
    exit 1
}

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

# Pure-C# timer callback — avoids PowerShell runspace thread starvation deadlock
# that occurs when a scriptblock-based TimerCallback fires while the main thread
# is blocked waiting for a subprocess (e.g. pip install).
if (-not ([System.Management.Automation.PSTypeName]'SpinnerTimer').Type) {
    Add-Type -TypeDefinition @'
using System;
using System.Collections;
using System.Threading;

public static class SpinnerTimer {
    private static readonly char[] Frames = { '|', '/', '-', '\\' };

    public static TimerCallback GetCallback() { return Tick; }

    private static void Tick(object state) {
        Hashtable s = (Hashtable)state;
        if ((bool)s["Done"]) return;
        int idx;
        lock (s.SyncRoot) { idx = (int)s["Idx"]; s["Idx"] = idx + 1; }
        string msg = String.Format("  [{0}]  {1}       ", Frames[idx % 4], (string)s["Desc"]);
        try {
            Console.SetCursorPosition(0, (int)s["Row"]);
            string c = (string)s["Cyan"], r = (string)s["Reset"];
            if (c.Length > 0) Console.Write(c + msg + r);
            else              Console.Write(msg);
        } catch { }
    }
}
'@
}
$RepoRoot = Split-Path $PSScriptRoot -Parent
Set-Location $RepoRoot

# ─── Script-scope state ───────────────────────────────────────────────────────
$script:UseAnsi       = $false
$script:ESC           = [char]27
$script:TermWidth     = 52
$script:PythonExe     = 'python'
$script:VenvPython    = $null
$script:DepsStatus    = ''
$script:ServerProcess = $null
$script:StderrLines   = $null
$script:PipStderr     = $null
$script:HadError      = $false
$script:TempErrFile   = $null
$script:AnsiColors    = @{}

# ─── ANSI initialisation ──────────────────────────────────────────────────────
function Initialize-Ansi {
    $isModern = ($null -ne $env:WT_SESSION) -or ($env:TERM_PROGRAM -eq 'vscode')
    if (-not $isModern -and $Host.Name -eq 'ConsoleHost') {
        try {
            $k32 = Add-Type -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint m);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint m);
[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int n);
'@ -Name K32 -Namespace Win32VT -PassThru -ErrorAction Stop
            $handle = $k32::GetStdHandle(-11)
            $mode   = [uint32]0
            $k32::GetConsoleMode($handle, [ref]$mode) | Out-Null
            $k32::SetConsoleMode($handle, ($mode -bor [uint32]0x0004)) | Out-Null
            $isModern = $true
        } catch { }
    }
    $script:UseAnsi = $isModern
    $e = $script:ESC
    $script:AnsiColors = @{
        Cyan     = "$e[96m"
        Yellow   = "$e[93m"
        Green    = "$e[92m"
        Red      = "$e[91m"
        White    = "$e[97m"
        DarkGray = "$e[90m"
        DarkCyan = "$e[36m"
        Bold     = "$e[1m"
        Reset    = "$e[0m"
    }
}

function Get-TerminalWidth {
    try {
        $w = $Host.UI.RawUI.WindowSize.Width
        if ($w -lt 1) { return 52 }
        return [Math]::Max(52, [Math]::Min($w, 120))
    } catch { return 52 }
}

# ─── Unified colored output ───────────────────────────────────────────────────
function Write-Colored {
    param(
        [string]$Text,
        [string]$Color  = 'White',
        [switch]$NoNewline
    )
    if ($script:UseAnsi) {
        $c = $script:AnsiColors[$Color]
        $r = $script:AnsiColors['Reset']
        if ($NoNewline) { [Console]::Write("$c$Text$r") }
        else            { [Console]::WriteLine("$c$Text$r") }
    } else {
        $map = @{
            Cyan='Cyan'; Yellow='Yellow'; Green='Green'; Red='Red';
            White='White'; DarkGray='DarkGray'; DarkCyan='DarkCyan'; Bold='White'
        }
        $fc = if ($map.ContainsKey($Color)) { $map[$Color] } else { 'White' }
        if ($NoNewline) { Write-Host $Text -ForegroundColor $fc -NoNewline }
        else            { Write-Host $Text -ForegroundColor $fc }
    }
}


function Show-TitleCard {
    Clear-Host
    $e = $script:ESC
    $innerWidth = 50
    $bar = '=' * $innerWidth
    $blank = ' ' * $innerWidth

    Write-Colored "  /$bar\" -Color Cyan
    Write-Colored "  |$blank|" -Color Cyan
    # Title line — Yellow bold
    $title = '>>>  THE FORGOTTEN REALM  <<<'
    $pad   = [Math]::Max(0, [int](($innerWidth - $title.Length) / 2))
    $titleLine = (' ' * $pad) + $title
    $titleLine = $titleLine.PadRight($innerWidth)
    Write-Colored "  |" -Color Cyan -NoNewline
    if ($script:UseAnsi) {
        [Console]::Write("$e[93m$e[1m$titleLine$e[0m")
        Write-Colored "|" -Color Cyan
    } else {
        Write-Host $titleLine -ForegroundColor Yellow -NoNewline
        Write-Colored "|" -Color Cyan
    }
    # Subtitle
    $sub     = 'Eldoria Village'
    $subPad  = [Math]::Max(0, [int](($innerWidth - $sub.Length) / 2))
    $subLine = (' ' * $subPad) + $sub
    $subLine = $subLine.PadRight($innerWidth)
    Write-Colored "  |" -Color Cyan -NoNewline
    Write-Colored $subLine -Color DarkCyan -NoNewline
    Write-Colored "|" -Color Cyan

    Write-Colored "  |$blank|" -Color Cyan
    Write-Colored "  \$bar/" -Color Cyan
    Write-Host ""
}

function Show-SuccessBanner {
    param([string]$LocalUrl, [string]$NetworkUrl)
    Write-Host ""
    $lines = @(
        " ",
        "   Game is running!",
        " ",
        "   Local:    $LocalUrl",
        "   Network:  $NetworkUrl",
        " ",
        "   Press Ctrl+C to stop the server",
        " "
    )
    $innerWidth = [Math]::Max(50, ($lines | ForEach-Object { $_.Length } | Measure-Object -Maximum).Maximum + 1)
    $bar = '-' * $innerWidth
    Write-Colored "  +$bar+" -Color Green
    foreach ($line in $lines) {
        $padded = $line.PadRight($innerWidth)
        Write-Colored "  |" -Color Green -NoNewline
        if ($line -match 'Game is running') {
            $e = $script:ESC
            if ($script:UseAnsi) {
                [Console]::Write("$e[92m$e[1m$padded$e[0m")
            } else {
                Write-Host $padded -ForegroundColor Green -NoNewline
            }
        } elseif ($line -match 'http://') {
            Write-Colored $padded -Color Cyan -NoNewline
        } elseif ($line -match 'Ctrl\+C') {
            Write-Colored $padded -Color DarkGray -NoNewline
        } else {
            Write-Colored $padded -Color White -NoNewline
        }
        Write-Colored "|" -Color Green
    }
    Write-Colored "  +$bar+" -Color Green
    Write-Host ""
}

function Show-ErrorBox {
    param([string]$Title, [string[]]$Lines)
    $innerWidth = 50
    $bar = '-' * $innerWidth
    $titleFull = "-- $Title "
    $titleFull = $titleFull.PadRight($innerWidth, '-')
    Write-Colored "  +$titleFull+" -Color Red
    foreach ($line in ($Lines | Select-Object -Last 10)) {
        if ($null -eq $line) { $line = '' }
        $padded = "  $line"
        if ($padded.Length -gt $innerWidth) { $padded = $padded.Substring(0, $innerWidth - 3) + '...' }
        $padded = $padded.PadRight($innerWidth)
        Write-Colored "  |" -Color Red -NoNewline
        Write-Colored $padded -Color White -NoNewline
        Write-Colored "|" -Color Red
    }
    Write-Colored "  +$bar+" -Color Red
    Write-Host ""
}

function Show-ShutdownMessage {
    Write-Host ""
    Write-Colored "  --  Server stopped. Thanks for playing." -Color DarkGray
    Write-Host ""
}

# ─── Spinner ──────────────────────────────────────────────────────────────────
# Runs $Action synchronously on the main thread (so $script: vars persist),
# while a System.Threading.Timer fires every 100ms on a pool thread to animate
# the spinner character in-place. No Start-Job isolation issues.
function Invoke-WithSpinner {
    param(
        [string]$Description,
        [scriptblock]$Action,
        [switch]$WarnOnFailure
    )

    $nonInteractive = $false
    try {
        $w = $Host.UI.RawUI.WindowSize.Width
        if ($w -lt 1) { $nonInteractive = $true }
    } catch { $nonInteractive = $true }

    if ($nonInteractive) {
        Write-Colored "  ...  $Description" -Color Cyan
        try {
            & $Action
            Write-Colored "  [+]  $Description" -Color Green
            return $true
        } catch {
            if ($WarnOnFailure) { Write-Colored "  [!]  $Description" -Color Yellow; return $false }
            Write-Colored "  [X]  $Description" -Color Red
            throw
        }
    }

    # Reserve the spinner line — write a placeholder then record its row
    $frames = [char[]]@('|', '/', '-', '\')
    Write-Host "  [$($frames[0])]  $Description"
    $row = $Host.UI.RawUI.CursorPosition.Y - 1

    # Shared state hashtable — read by the C# SpinnerTimer callback on a pool thread
    $state = [hashtable]::Synchronized(@{
        Row   = $row
        Idx   = 0
        Desc  = $Description
        Done  = $false
        Cyan  = if ($script:UseAnsi) { $script:AnsiColors['Cyan'] } else { '' }
        Reset = if ($script:UseAnsi) { $script:AnsiColors['Reset'] } else { '' }
    })

    $timerCallback = [SpinnerTimer]::GetCallback()

    $timer = New-Object System.Threading.Timer($timerCallback, $state, 0, 100)

    try {
        & $Action
        $state.Done = $true
        $timer.Dispose()
        try { [Console]::SetCursorPosition(0, $row) } catch { }
        Write-Colored "  [+]  $Description                          " -Color Green
        return $true
    } catch {
        $state.Done = $true
        $timer.Dispose()
        try { [Console]::SetCursorPosition(0, $row) } catch { }
        if ($WarnOnFailure) {
            Write-Colored "  [!]  $Description                          " -Color Yellow
            return $false
        }
        Write-Colored "  [X]  $Description                          " -Color Red
        throw
    }
}


function Test-PortAvailability {
    # Try Get-NetTCPConnection first
    try {
        $conn = Get-NetTCPConnection -LocalPort 5000 -State Listen -ErrorAction SilentlyContinue |
                Select-Object -First 1
        if ($null -eq $conn) { return [PSCustomObject]@{ InUse=$false; Pid=0; ProcessName='' } }
        $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
        return [PSCustomObject]@{
            InUse       = $true
            Pid         = $conn.OwningProcess
            ProcessName = if ($proc) { $proc.ProcessName } else { 'unknown' }
        }
    } catch { }
    # Fallback: netstat
    $ns = netstat -ano 2>$null | Select-String ':5000\s' | Select-String 'LISTENING'
    if ($null -eq $ns) { return [PSCustomObject]@{ InUse=$false; Pid=0; ProcessName='' } }
    $pid_ = ($ns.Line.Trim() -split '\s+')[-1]
    $proc = Get-Process -Id $pid_ -ErrorAction SilentlyContinue
    return [PSCustomObject]@{
        InUse       = $true
        Pid         = [int]$pid_
        ProcessName = if ($proc) { $proc.ProcessName } else { 'unknown' }
    }
}

function Resolve-PortConflict {
    param([int]$ConflictPid, [string]$ProcessName)
    Write-Host ""
    Write-Colored "  [!]  Port 5000 in use by " -Color Yellow -NoNewline
    Write-Colored $ProcessName -Color White -NoNewline
    Write-Colored " (PID $ConflictPid)" -Color DarkGray
    Write-Colored "     Kill it and continue? " -Color Yellow -NoNewline
    Write-Colored "[Y/N] " -Color White -NoNewline
    $key = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
    Write-Host ""
    if ($key.Character -match '^[Yy]$') {
        try {
            Stop-Process -Id $ConflictPid -Force -ErrorAction Stop
            Start-Sleep -Milliseconds 500
            Write-Colored "  [+]  Process killed" -Color Green
            return $true
        } catch {
            Write-Colored "  [X]  Could not kill process: $_" -Color Red
            return $false
        }
    }
    return $false
}

function Get-LanIpAddress {
    try {
        $ip = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
              Where-Object {
                  $_.InterfaceAlias -notlike '*Loopback*' -and
                  $_.IPAddress -notlike '169.254.*'       -and
                  $_.IPAddress -ne '127.0.0.1'
              } | Select-Object -First 1 -ExpandProperty IPAddress
        if ($ip) { return $ip }
    } catch { }
    # Fallback: ipconfig parse
    $lines = ipconfig 2>$null
    foreach ($line in $lines) {
        if ($line -match 'IPv4.*?:\s*([\d.]+)') {
            $ip = $Matches[1]
            if ($ip -notlike '169.254.*') { return $ip }
        }
    }
    return 'N/A'
}

function Start-GameServer {
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName               = $script:VenvPython
    $psi.Arguments              = 'app.py'
    $psi.WorkingDirectory       = $RepoRoot
    $psi.UseShellExecute        = $false
    $psi.RedirectStandardError  = $true
    $psi.RedirectStandardOutput = $false
    $psi.CreateNoWindow         = $false

    $p = [System.Diagnostics.Process]::Start($psi)
    $script:StderrLines = [System.Collections.Generic.List[string]]::new()

    $errHandler = {
        param($sender, $e)
        if ($null -ne $e.Data) { $script:StderrLines.Add($e.Data) }
    }
    $p.add_ErrorDataReceived($errHandler)
    $p.BeginErrorReadLine()
    $script:ServerProcess = $p
}

function Wait-ServerReady {
    param([int]$TimeoutSeconds = 10)
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    while ([DateTime]::UtcNow -lt $deadline) {
        try {
            $tcp = New-Object System.Net.Sockets.TcpClient
            $ar  = $tcp.BeginConnect('127.0.0.1', 5000, $null, $null)
            $ok  = $ar.AsyncWaitHandle.WaitOne(300)
            if ($ok -and $tcp.Connected) { $tcp.Close(); return $true }
            $tcp.Close()
        } catch { }
        Start-Sleep -Milliseconds 200
    }
    return $false
}

# ─── Shortcut + icon (runs once on first launch) ─────────────────────────────
function New-SwordIcon {
    param([string]$Path)
    try { Add-Type -AssemblyName System.Drawing -ErrorAction Stop } catch { return }

    $size = 256
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g   = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode    = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.CompositingMode  = [System.Drawing.Drawing2D.CompositingMode]::SourceOver

    # Helper: solid brush by ARGB
    function SB([int]$a,[int]$r,[int]$gv,[int]$b) {
        return New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($a,$r,$gv,$b))
    }

    # Background — deep navy
    $br = SB 255 8 6 20; $g.FillRectangle($br, 0, 0, $size, $size); $br.Dispose()

    # Radial atmosphere glow (concentric ellipses from center outward)
    $glows = @(
        @(50,  55, 35, 100),
        @(38,  70, 45, 115),
        @(28,  50, 30,  90),
        @(18,  35, 18,  70),
        @(10,  20, 10,  50)
    )
    $radii = @(95, 72, 55, 38, 24)
    for ($i = 0; $i -lt $glows.Count; $i++) {
        $c = $glows[$i]; $r = $radii[$i]
        $br = SB $c[0] $c[1] $c[2] $c[3]
        $g.FillEllipse($br, (128 - $r), (115 - $r), ($r * 2), ($r * 2))
        $br.Dispose()
    }

    # Background stars — tiny 4-pointed crosses, gold-tinted
    $starPositions = @(@(38,42),@(208,32),@(218,198),@(30,192),@(68,228),@(188,222),@(155,55),@(95,48))
    foreach ($sp in $starPositions) {
        $sx = $sp[0]; $sy = $sp[1]
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(130,200,178,70), 1.5)
        $g.DrawLine($pen, $sx, $sy - 5, $sx, $sy + 5)
        $g.DrawLine($pen, $sx - 5, $sy, $sx + 5, $sy)
        $pen.Dispose()
        $br = SB 160 230 210 90
        $g.FillEllipse($br, ($sx - 1.5), ($sy - 1.5), 3, 3)
        $br.Dispose()
    }

    # ── BLADE ──
    # Shadow half (left)
    $pts = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(128, 14),
        [System.Drawing.PointF]::new(128, 162),
        [System.Drawing.PointF]::new(115, 162)
    )
    $br = SB 255 148 158 182; $g.FillPolygon($br, $pts); $br.Dispose()

    # Light half (right)
    $pts = [System.Drawing.PointF[]]@(
        [System.Drawing.PointF]::new(128, 14),
        [System.Drawing.PointF]::new(141, 162),
        [System.Drawing.PointF]::new(128, 162)
    )
    $br = SB 255 210 220 240; $g.FillPolygon($br, $pts); $br.Dispose()

    # Center ridge / highlight line
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 248, 252, 255), 2)
    $g.DrawLine($pen, 128, 16, 128, 160)
    $pen.Dispose()

    # Fuller (groove, semi-transparent dark)
    $br = SB 100 80 92 120; $g.FillRectangle($br, 124, 28, 3, 125); $br.Dispose()

    # Blade tip glow — soft cyan corona
    $br = SB 45 160 210 255; $g.FillEllipse($br, 110, 4, 36, 36); $br.Dispose()
    $br = SB 25 200 230 255; $g.FillEllipse($br, 116, 8, 24, 24);  $br.Dispose()

    # ── CROSSGUARD ──
    # Base gold fill
    $br = SB 255 195 158 38
    $g.FillRectangle($br, 64, 160, 128, 16)
    $br.Dispose()
    # Rounded end caps
    $br = SB 255 195 158 38
    $g.FillEllipse($br, 54, 160, 18, 16)
    $g.FillEllipse($br, 184, 160, 18, 16)
    $br.Dispose()
    # Top highlight
    $br = SB 255 248 208 82; $g.FillRectangle($br, 64, 160, 128, 4); $br.Dispose()
    $br = SB 255 248 208 82; $g.FillEllipse($br, 54, 160, 18, 6);    $br.Dispose()
    $br = SB 255 248 208 82; $g.FillEllipse($br, 184, 160, 18, 6);   $br.Dispose()
    # Bottom shadow
    $br = SB 255 138 108 18; $g.FillRectangle($br, 64, 172, 128, 4); $br.Dispose()

    # ── GRIP ──
    $br = SB 255 52 28 12; $g.FillRectangle($br, 121, 176, 14, 44); $br.Dispose()
    # Leather wrap bands
    $br = SB 255 80 48 22
    for ($wy = 179; $wy -lt 218; $wy += 7) { $g.FillRectangle($br, 121, $wy, 14, 3) }
    $br.Dispose()
    # Grip edge sheen
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(60, 120, 80, 40), 1)
    $g.DrawRectangle($pen, 121, 176, 13, 43)
    $pen.Dispose()

    # ── POMMEL ──
    # Gold body
    $br = SB 255 195 158 38; $g.FillEllipse($br, 109, 213, 38, 38); $br.Dispose()
    # Highlight arc
    $br = SB 255 248 208 82; $g.FillEllipse($br, 112, 215, 20, 14); $br.Dispose()
    # Rim shadow
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 130, 100, 15), 2)
    $g.DrawEllipse($pen, 110, 214, 36, 36)
    $pen.Dispose()
    # Ruby gem
    $br = SB 255 175 20 20; $g.FillEllipse($br, 120, 223, 16, 16); $br.Dispose()
    # Gem facet highlight
    $br = SB 200 255, 155, 155; $g.FillEllipse($br, 122, 225, 7, 5); $br.Dispose()
    # Gem deep shadow
    $br = SB 180 100 5 5; $g.FillEllipse($br, 126, 230, 7, 6); $br.Dispose()

    $g.Dispose()

    # Encode as PNG then wrap in minimal ICO container
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $png = $ms.ToArray(); $ms.Dispose(); $bmp.Dispose()

    $out = New-Object System.IO.MemoryStream
    $w   = New-Object System.IO.BinaryWriter($out)
    $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)  # ICONDIR
    $w.Write([byte]0);  $w.Write([byte]0);  $w.Write([byte]0);  $w.Write([byte]0)  # entry header
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$png.Length); $w.Write([uint32]22)            # size + offset
    $w.Write($png, 0, $png.Length)
    $w.Flush()
    [System.IO.File]::WriteAllBytes($Path, $out.ToArray())
    $w.Dispose(); $out.Dispose()
}

function Initialize-Shortcut {
    $desktop = [System.Environment]::GetFolderPath('Desktop')
    $lnkPath = Join-Path $desktop 'The Forgotten Realm.lnk'
    if (Test-Path $lnkPath) { return }
    $icoPath = Join-Path $PSScriptRoot 'game-icon.ico'
    Write-Host ""
    Write-Colored "  Add a desktop shortcut for The Forgotten Realm? " -Color Yellow -NoNewline
    Write-Colored "[Y/N] " -Color White -NoNewline
    try {
        $key = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
        Write-Host ""
        if ($key.Character -notmatch '^[Yy]$') { return }
    } catch { return }
    try {
        if (-not (Test-Path $icoPath)) { New-SwordIcon -Path $icoPath }
        $shell = New-Object -ComObject WScript.Shell
        $sc = $shell.CreateShortcut($lnkPath)
        $sc.TargetPath       = Join-Path $PSScriptRoot 'launch.bat'
        $sc.WorkingDirectory = $RepoRoot
        $sc.IconLocation     = "$icoPath,0"
        $sc.Description      = 'The Forgotten Realm - Eldoria Village'
        $sc.Save()
        Write-Colored "  [+]  Shortcut added to desktop" -Color Green
    } catch { }
    Write-Host ""
}

# ─── API key first-run setup ──────────────────────────────────────────────────
function Ensure-ApiKey {
    $envPath = Join-Path $RepoRoot '.env'

    # Read existing key if the file is present
    $existingKey = ''
    if (Test-Path $envPath) {
        $lines = Get-Content $envPath -ErrorAction SilentlyContinue
        foreach ($line in $lines) {
            if ($line -match '^GROQ_API_KEY\s*=\s*(.+)$') {
                $existingKey = $Matches[1].Trim()
                break
            }
        }
    }
    if ($existingKey.Length -gt 10) { return }  # already configured

    # ── No key found — walk the user through setup ────────────────────────────
    Write-Host ""
    $innerWidth = 50
    $bar        = '─' * $innerWidth
    $titleFull  = '-- First-time Setup '.PadRight($innerWidth, '-')
    Write-Colored "  +$titleFull+" -Color Yellow
    $setupLines = @(
        ' ',
        '  NPC dialogue requires a free Groq API key.',
        '  Opening console.groq.com in your browser...',
        ' ',
        '  1. Sign in (free — no credit card needed)',
        '  2. Click "Create API Key"',
        '  3. Copy the key and paste it below',
        ' '
    )
    foreach ($l in $setupLines) {
        $padded = $l.PadRight($innerWidth)
        Write-Colored "  |" -Color Yellow -NoNewline
        Write-Colored $padded -Color White -NoNewline
        Write-Colored "|" -Color Yellow
    }
    Write-Colored "  +$bar+" -Color Yellow
    Write-Host ""

    # Open the browser automatically
    try { Start-Process 'https://console.groq.com' } catch { }

    # Prompt for the key
    while ($true) {
        Write-Colored "  Paste your Groq API key: " -Color Cyan -NoNewline
        $inputKey = Read-Host
        $inputKey = $inputKey.Trim()

        if ($inputKey.Length -lt 20) {
            Write-Colored "  [X]  That doesn't look right - the key should be much longer. Try again." -Color Red
            Write-Host ""
            continue
        }
        if (-not $inputKey.StartsWith('gsk_')) {
            Write-Colored "  [!]  Groq keys usually start with 'gsk_' - are you sure this is correct?" -Color Yellow
            Write-Colored "     Press Enter to use it anyway, or type 'retry' to re-enter: " -Color DarkGray -NoNewline
            $confirm = Read-Host
            if ($confirm.Trim().ToLower() -eq 'retry') {
                Write-Host ""
                continue
            }
        }
        break
    }

    # Write (or update) the .env file, preserving any other lines
    if (Test-Path $envPath) {
        $existing = @(Get-Content $envPath -ErrorAction SilentlyContinue)
        $filtered = @($existing | Where-Object { $_ -notmatch '^GROQ_API_KEY\s*=' })
        $filtered += "GROQ_API_KEY=$inputKey"
        [System.IO.File]::WriteAllLines($envPath, $filtered)
    } else {
        [System.IO.File]::WriteAllText($envPath, "GROQ_API_KEY=$inputKey`n")
    }

    Write-Host ""
    Write-Colored "  [+]  API key saved to .env - you won't be asked again." -Color Green
    Write-Host ""
}

# ─── Main ─────────────────────────────────────────────────────────────────────
Initialize-Ansi
$script:TermWidth = Get-TerminalWidth
Initialize-Shortcut   # silent first-run: creates icon + shortcut if absent
Show-TitleCard
Ensure-ApiKey

try {
    # Step 1 — Python
    Invoke-WithSpinner -Description "Python 3 environment" -Action {
        $out = & python --version 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Python not found on PATH." }
        $ver = ($out -replace 'Python\s+', '').Trim()
        if (-not $ver.StartsWith('3')) { throw "Python 3 required. Found: $ver" }
        $script:PyVersion = $ver
        $script:PythonExe = 'python'
    } | Out-Null

    # Step 2 — Venv
    Invoke-WithSpinner -Description "Virtual environment" -Action {
        $venvPy = Join-Path $RepoRoot 'venv\Scripts\python.exe'
        if (-not (Test-Path $venvPy)) {
            $proc = Start-Process -FilePath 'python' -ArgumentList '-m venv venv' `
                -NoNewWindow -Wait -PassThru -WorkingDirectory $RepoRoot
            if ($proc.ExitCode -ne 0) { throw "Failed to create virtual environment." }
        }
        $script:VenvPython = $venvPy
    } | Out-Null

    # Step 3 — Dependencies
    $depsDesc = "Checking dependencies"
    Invoke-WithSpinner -Description $depsDesc -Action {
        $reqPath   = Join-Path $RepoRoot 'requirements.txt'
        $cachePath = Join-Path $RepoRoot '.deps-installed'
        if (-not (Test-Path $reqPath)) { $script:DepsStatus = 'no requirements.txt'; return }
        if (Test-Path $cachePath) {
            $reqM   = (Get-Item $reqPath).LastWriteTimeUtc
            $cacheM = (Get-Item $cachePath).LastWriteTimeUtc
            if ($cacheM -ge $reqM) { $script:DepsStatus = 'cached'; return }
        }
        $pipOutput = & $script:VenvPython -m pip install -r $reqPath -q --disable-pip-version-check 2>&1
        if ($LASTEXITCODE -ne 0) {
            $script:PipStderr = ($pipOutput | Select-Object -Last 10 | ForEach-Object { "$_" })
            throw "pip install failed (exit $LASTEXITCODE)"
        }
        [System.IO.File]::WriteAllText($cachePath, (Get-Date -Format 'o'))
        $script:DepsStatus = 'installed'
    } | Out-Null

    # Step 4 — Git update (warn-only; skipped when local changes are present)
    Invoke-WithSpinner -Description "Checking for updates" -WarnOnFailure -Action {
        $git = Get-Command git -ErrorAction SilentlyContinue
        if ($null -eq $git) { return }
        $dirty = & git status --porcelain 2>&1
        if ($dirty) { return }   # local changes — skip pull silently
        & git pull --ff-only 2>&1 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Git pull failed (offline or conflict)" }
    } | Out-Null

    Write-Host ""

    # Step 5 — Port check
    $portInfo = Test-PortAvailability
    if ($portInfo.InUse) {
        $resolved = Resolve-PortConflict -ConflictPid $portInfo.Pid -ProcessName $portInfo.ProcessName
        if (-not $resolved) {
            Write-Colored "  Exiting. Close the process on port 5000 and retry." -Color DarkGray
            exit 1
        }
        Write-Host ""
    }

    # Step 6 — Start server
    Invoke-WithSpinner -Description "Starting Flask server" -Action {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName               = $script:VenvPython
        $psi.Arguments              = 'app.py'
        $psi.WorkingDirectory       = $RepoRoot
        $psi.UseShellExecute        = $false
        $psi.RedirectStandardError  = $true
        $psi.RedirectStandardOutput = $false
        $psi.CreateNoWindow         = $false
        $p = [System.Diagnostics.Process]::Start($psi)
        $script:StderrLines = [System.Collections.Generic.List[string]]::new()
        $p.add_ErrorDataReceived({ param($s,$e); if ($null -ne $e.Data) { $script:StderrLines.Add($e.Data) } })
        $p.BeginErrorReadLine()
        $script:ServerProcess = $p
    } | Out-Null

    # Step 7 — Wait for ready
    $ready = Wait-ServerReady -TimeoutSeconds 10
    if ($ready) {
        Write-Colored "  [+]  Server is responding                           " -Color Green
        Start-Process 'http://127.0.0.1:5000'
    } else {
        Write-Colored "  [!]  Server may be slow to start - opening browser anyway" -Color Yellow
        Start-Process 'http://127.0.0.1:5000'
    }

    $lanIp = Get-LanIpAddress
    Show-SuccessBanner -LocalUrl 'http://localhost:5000' -NetworkUrl "http://${lanIp}:5000"

    # Block until server exits (Ctrl+C triggers finally)
    $script:ServerProcess.WaitForExit()

    if ($script:ServerProcess.ExitCode -ne 0) {
        $lastLines = $script:StderrLines | Select-Object -Last 10
        if ($lastLines.Count -gt 0) {
            Show-ErrorBox -Title "Server crashed (exit $($script:ServerProcess.ExitCode))" -Lines $lastLines
        }
    }

} catch {
    $script:HadError = $true
    $errLines = @($_.Exception.Message)
    if ($script:PipStderr) { $errLines += $script:PipStderr }
    Show-ErrorBox -Title "Launch failed" -Lines $errLines
    exit 1
} finally {
    if ($null -ne $script:ServerProcess) {
        if (-not $script:ServerProcess.HasExited) {
            try { $script:ServerProcess.Kill(); $script:ServerProcess.WaitForExit(3000) | Out-Null } catch { }
        }
        try { $script:ServerProcess.Dispose() } catch { }
    }
    if ($script:TempErrFile -and (Test-Path $script:TempErrFile)) {
        Remove-Item $script:TempErrFile -Force -ErrorAction SilentlyContinue
    }
    Show-ShutdownMessage
    if ($script:HadError) {
        Write-Colored "  Press any key to close..." -Color DarkGray -NoNewline
        try { $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown') | Out-Null } catch { Read-Host }
    }
}
