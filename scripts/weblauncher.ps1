#Requires -Version 5.1
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

trap {
    $msg   = "ERROR: $($_.Exception.Message)"
    $trace = $_.ScriptStackTrace
    try { Write-Host "`n$msg" -ForegroundColor Red } catch {}
    try { Write-Host $trace  -ForegroundColor DarkGray } catch {}
    try {
        $logPath = "$env:TEMP\tfr-weblauncher-error.txt"
        "$msg`n`n$trace" | Out-File $logPath -Force
        Write-Host "`nFull error saved to: $logPath" -ForegroundColor DarkGray
    } catch {}
    try { Read-Host "`nPress Enter to close" } catch {}
    exit 1
}

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8

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
$script:UseAnsi    = $false
$script:ESC        = [char]27
$script:TermWidth  = 52
$script:AnsiColors = @{}

$GAME_URL = 'https://the-forgotten-realm.onrender.com/'

# ─── ANSI initialisation ──────────────────────────────────────────────────────
function Initialize-Ansi {
    $isModern = ($null -ne $env:WT_SESSION) -or ($env:TERM_PROGRAM -eq 'vscode')
    if (-not $isModern -and $Host.Name -eq 'ConsoleHost') {
        try {
            $k32 = Add-Type -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint m);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint m);
[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int n);
'@ -Name K32Web -Namespace Win32VTWeb -PassThru -ErrorAction Stop
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

# ─── Spinner ──────────────────────────────────────────────────────────────────
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
        Write-Colored "  ...  $Description" -Color Green
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

    $frames = [char[]]@('|', '/', '-', '\')
    Write-Host "  [$($frames[0])]  $Description"
    $row = $Host.UI.RawUI.CursorPosition.Y - 1

    $state = [hashtable]::Synchronized(@{
        Row   = $row
        Idx   = 0
        Desc  = $Description
        Done  = $false
        Cyan  = if ($script:UseAnsi) { $script:AnsiColors['Green'] } else { '' }
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

# ─── Title card — Green border marks this as the web/online launcher ──────────
function Show-TitleCard {
    Clear-Host
    $e          = $script:ESC
    $innerWidth = 50
    $bar        = '=' * $innerWidth
    $blank      = ' ' * $innerWidth

    Write-Colored "  /$bar\" -Color Green
    Write-Colored "  |$blank|" -Color Green

    $title    = '>>>  THE FORGOTTEN REALM  <<<'
    $pad      = [Math]::Max(0, [int](($innerWidth - $title.Length) / 2))
    $titleLine = (' ' * $pad) + $title
    $titleLine = $titleLine.PadRight($innerWidth)
    Write-Colored "  |" -Color Green -NoNewline
    if ($script:UseAnsi) {
        [Console]::Write("$e[93m$e[1m$titleLine$e[0m")
        Write-Colored "|" -Color Green
    } else {
        Write-Host $titleLine -ForegroundColor Yellow -NoNewline
        Write-Colored "|" -Color Green
    }

    $sub     = 'Play Online'
    $subPad  = [Math]::Max(0, [int](($innerWidth - $sub.Length) / 2))
    $subLine = (' ' * $subPad) + $sub
    $subLine = $subLine.PadRight($innerWidth)
    Write-Colored "  |" -Color Green -NoNewline
    Write-Colored $subLine -Color DarkCyan -NoNewline
    Write-Colored "|" -Color Green

    Write-Colored "  |$blank|" -Color Green
    Write-Colored "  \$bar/" -Color Green
    Write-Host ""
}

function Show-ErrorBox {
    param([string]$Title, [string[]]$Lines)
    $innerWidth = 50
    $bar        = '-' * $innerWidth
    $titleFull  = "-- $Title "
    $titleFull  = $titleFull.PadRight($innerWidth, '-')
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

# ─── Orb icon — emerald crystal ball with gold ring ──────────────────────────
# Visually distinct from the sword icon: different shape, green palette, sapphire accents
function New-OrbIcon {
    param([string]$Path)
    try { Add-Type -AssemblyName System.Drawing -ErrorAction Stop } catch { return }

    $size = 256
    $bmp  = New-Object System.Drawing.Bitmap($size, $size)
    $g    = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode   = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceOver

    function SB([int]$a,[int]$r,[int]$gv,[int]$b) {
        return New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb($a,$r,$gv,$b))
    }

    # Background — same deep navy as sword icon
    $br = SB 255 8 6 20; $g.FillRectangle($br, 0, 0, $size, $size); $br.Dispose()

    # Atmospheric glow — green-tinted (vs blue-green in sword)
    $glows  = @(@(55,18,80,38), @(42,12,65,30), @(30,8,50,22), @(18,5,35,15), @(10,3,22,10))
    $radii  = @(100, 78, 58, 40, 26)
    for ($i = 0; $i -lt $glows.Count; $i++) {
        $c = $glows[$i]; $r = $radii[$i]
        $br = SB $c[0] $c[1] $c[2] $c[3]
        $g.FillEllipse($br, (128 - $r), (118 - $r), ($r * 2), ($r * 2))
        $br.Dispose()
    }

    # Background stars — same gold-tinted crosses as sword icon, different positions
    $starPos = @(@(42,38),@(205,28),@(215,205),@(34,198),@(72,232),@(185,225),@(160,50),@(90,44),@(220,110),@(28,115))
    foreach ($sp in $starPos) {
        $sx = $sp[0]; $sy = $sp[1]
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120,180,220,80), 1.5)
        $g.DrawLine($pen, $sx, $sy - 5, $sx, $sy + 5)
        $g.DrawLine($pen, $sx - 5, $sy, $sx + 5, $sy)
        $pen.Dispose()
        $br = SB 150 200 230 100
        $g.FillEllipse($br, ($sx - 1.5), ($sy - 1.5), 3, 3)
        $br.Dispose()
    }

    # ── ORB BODY ──
    # Orb center: (128, 112), radius: 62
    # Outer dark base — deep forest green
    $br = SB 255 8 42 18;  $g.FillEllipse($br,  66,  50, 124, 124); $br.Dispose()
    # Mid layer — richer emerald
    $br = SB 255 14 78 32;  $g.FillEllipse($br,  74,  58, 108, 108); $br.Dispose()
    # Inner bright core — vivid green
    $br = SB 220 22 130 55; $g.FillEllipse($br,  88,  72,  80,  80); $br.Dispose()
    # Innermost hot spot — near-white green
    $br = SB 160 80 200 110; $g.FillEllipse($br, 102,  86,  52,  52); $br.Dispose()

    # Specular highlight — upper-left glassy reflection
    $br = SB 200 200 255 220; $g.FillEllipse($br,  82,  58,  44,  30); $br.Dispose()
    $br = SB 120 240 255 245; $g.FillEllipse($br,  88,  62,  22,  14); $br.Dispose()

    # Outer rim darkening — gives the sphere depth
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(180, 4, 28, 12), 6)
    $g.DrawEllipse($pen, 66, 50, 124, 124)
    $pen.Dispose()

    # ── GOLD RING ──
    # Equatorial gold ring around the orb
    $br = SB 255 195 158 38; $g.FillEllipse($br, 58, 102, 140, 28); $br.Dispose()
    # Inner cutout to make it look like a ring (not a disc)
    $br = SB 255 8 6 20;     $g.FillEllipse($br, 68, 107, 120, 18); $br.Dispose()
    # Orb body patch — fill back where the inner cutout ate into the orb
    $br = SB 255 14 78 32;   $g.FillEllipse($br, 74, 108, 108, 16); $br.Dispose()
    $br = SB 180 22 130 55;  $g.FillEllipse($br, 88, 109,  80, 14); $br.Dispose()
    # Ring top highlight
    $br = SB 255 248 208 82; $g.FillEllipse($br, 58, 102, 140,  8); $br.Dispose()
    # Ring bottom shadow
    $br = SB 255 120 90  12; $g.FillEllipse($br, 58, 122, 140,  8); $br.Dispose()
    # Ring outer rim
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 140, 108, 20), 2)
    $g.DrawEllipse($pen, 58, 102, 140, 28)
    $pen.Dispose()

    # ── SAPPHIRE GEMS on ring at 9-o'clock and 3-o'clock ──
    # Left gem
    $br = SB 255 20 60 190;  $g.FillEllipse($br, 50, 108, 18, 18); $br.Dispose()
    $br = SB 200 100 160 255; $g.FillEllipse($br, 52, 110,  8,  6); $br.Dispose()
    $br = SB 180 10  30 120;  $g.FillEllipse($br, 55, 117,  8,  6); $br.Dispose()
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 140, 108, 20), 1.5)
    $g.DrawEllipse($pen, 50, 108, 18, 18)
    $pen.Dispose()
    # Right gem
    $br = SB 255 20 60 190;  $g.FillEllipse($br, 188, 108, 18, 18); $br.Dispose()
    $br = SB 200 100 160 255; $g.FillEllipse($br, 190, 110,  8,  6); $br.Dispose()
    $br = SB 180 10  30 120;  $g.FillEllipse($br, 193, 117,  8,  6); $br.Dispose()
    $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(255, 140, 108, 20), 1.5)
    $g.DrawEllipse($pen, 188, 108, 18, 18)
    $pen.Dispose()

    # ── BASE SHADOW — soft drop shadow under the whole orb ──
    $br = SB 80 0 0 0; $g.FillEllipse($br, 78, 182, 100, 18); $br.Dispose()
    $br = SB 40 0 0 0; $g.FillEllipse($br, 68, 186, 120, 14); $br.Dispose()

    # ── EMERALD GLOW pulse — outer aura ──
    $br = SB 30 20 200 80;  $g.FillEllipse($br, 48,  32, 160, 160); $br.Dispose()
    $br = SB 18 30 240 100; $g.FillEllipse($br, 56,  40, 144, 144); $br.Dispose()

    $g.Dispose()

    # Encode as PNG, wrap in minimal ICO container (identical to sword icon)
    $ms  = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $png = $ms.ToArray(); $ms.Dispose(); $bmp.Dispose()

    $out = New-Object System.IO.MemoryStream
    $w   = New-Object System.IO.BinaryWriter($out)
    $w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)
    $w.Write([byte]0);  $w.Write([byte]0);  $w.Write([byte]0);  $w.Write([byte]0)
    $w.Write([uint16]1); $w.Write([uint16]32)
    $w.Write([uint32]$png.Length); $w.Write([uint32]22)
    $w.Write($png, 0, $png.Length)
    $w.Flush()
    [System.IO.File]::WriteAllBytes($Path, $out.ToArray())
    $w.Dispose(); $out.Dispose()
}

# ─── Web shortcut — named distinctly from the local shortcut ─────────────────
function Initialize-WebShortcut {
    $desktop = [System.Environment]::GetFolderPath('Desktop')
    $lnkPath = Join-Path $desktop 'The Forgotten Realm - Online.lnk'
    if (Test-Path $lnkPath) { return }
    $icoPath = Join-Path $PSScriptRoot 'web-icon.ico'
    Write-Host ""
    Write-Colored "  Add a desktop shortcut for The Forgotten Realm (Online)? " -Color Yellow -NoNewline
    Write-Colored "[Y/N] " -Color White -NoNewline
    try {
        $key = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
        Write-Host ""
        if ($key.Character -notmatch '^[Yy]$') { return }
    } catch { return }
    try {
        if (-not (Test-Path $icoPath)) { New-OrbIcon -Path $icoPath }
        $shell = New-Object -ComObject WScript.Shell
        $sc = $shell.CreateShortcut($lnkPath)
        $sc.TargetPath       = Join-Path $PSScriptRoot 'weblauncher.bat'
        $sc.WorkingDirectory = $RepoRoot
        $sc.IconLocation     = "$icoPath,0"
        $sc.Description      = 'The Forgotten Realm - Play Online'
        $sc.Save()
        Write-Colored "  [+]  Shortcut added to desktop" -Color Green
    } catch { }
    Write-Host ""
}

# ─── Main ─────────────────────────────────────────────────────────────────────
Initialize-Ansi
$script:TermWidth = Get-TerminalWidth
Initialize-WebShortcut
Show-TitleCard

try {

    # Step 1 — Internet check
    Invoke-WithSpinner -Description "Checking internet connection" -Action {
        $ok = Test-NetConnection -ComputerName github.com -Port 443 `
              -InformationLevel Quiet -WarningAction SilentlyContinue
        if (-not $ok) { throw "No internet connection detected." }
    } | Out-Null

    # Step 2 — Ping game server, detect warm vs cold start
    $script:ServerWarm = $false
    $script:PingMs     = 9999

    Invoke-WithSpinner -Description "Reaching game server" -WarnOnFailure -Action {
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        try {
            $resp = Invoke-WebRequest -Uri $GAME_URL -Method Head `
                    -TimeoutSec 8 -UseBasicParsing -ErrorAction Stop
            $sw.Stop()
            $script:PingMs     = [int]$sw.Elapsed.TotalMilliseconds
            $script:ServerWarm = ($script:PingMs -lt 2500)
        } catch {
            $sw.Stop()
            # Server responded with an error status — it's awake, just not happy
            if ($sw.Elapsed.TotalSeconds -lt 8) {
                $script:PingMs     = [int]$sw.Elapsed.TotalMilliseconds
                $script:ServerWarm = ($script:PingMs -lt 2500)
            } else {
                throw "Server did not respond within 8 seconds."
            }
        }
    } | Out-Null

    # Rewrite the server line to include response time
    try {
        $row = $Host.UI.RawUI.CursorPosition.Y - 1
        [Console]::SetCursorPosition(0, $row)
        if ($script:ServerWarm) {
            Write-Colored "  [+]  Server is warm ($($script:PingMs)ms)                                " -Color Green
        } else {
            Write-Colored "  [!]  Server is warming up - first load may take ~30s           " -Color Yellow
        }
    } catch { }

    # Cold start notice
    if (-not $script:ServerWarm) {
        Write-Host ""
        $innerWidth = 50
        $bar        = '-' * $innerWidth
        $titleFull  = '-- Cold Start '.PadRight($innerWidth, '-')
        Write-Colored "  +$titleFull+" -Color Yellow
        $warnLines = @(
            ' ',
            "  The server hasn't been visited recently.",
            '  Render spins it down after ~15 minutes of idle.',
            ' ',
            '  The browser will open now - just wait up to 30s',
            '  for the page to load. It only happens once.',
            ' '
        )
        foreach ($l in $warnLines) {
            $padded = $l.PadRight($innerWidth)
            Write-Colored "  |" -Color Yellow -NoNewline
            Write-Colored $padded -Color White -NoNewline
            Write-Colored "|" -Color Yellow
        }
        Write-Colored "  +$bar+" -Color Yellow
        Write-Host ""
    }

    # Step 3 — Open browser
    Invoke-WithSpinner -Description "Opening game in browser" -Action {
        Start-Process $GAME_URL
    } | Out-Null

    Write-Host ""

    # Success banner
    $innerWidth = 50
    $bar        = '=' * $innerWidth
    $blank      = ' ' * $innerWidth
    $e          = $script:ESC

    Write-Colored "  /$bar\" -Color Green
    Write-Colored "  |$blank|" -Color Green

    $doneTitle = '   [+]  Game opened in your browser!'
    Write-Colored "  |" -Color Green -NoNewline
    if ($script:UseAnsi) {
        [Console]::Write("$e[92m$e[1m$($doneTitle.PadRight($innerWidth))$e[0m")
        Write-Colored "|" -Color Green
    } else {
        Write-Host $doneTitle.PadRight($innerWidth) -ForegroundColor Green -NoNewline
        Write-Colored "|" -Color Green
    }

    Write-Colored "  |$blank|" -Color Green

    $urlLine = "   $GAME_URL"
    Write-Colored "  |" -Color Green -NoNewline
    Write-Colored $urlLine.PadRight($innerWidth) -Color Cyan -NoNewline
    Write-Colored "|" -Color Green

    Write-Colored "  |$blank|" -Color Green

    $hintLine = if ($script:ServerWarm) {
        '   Server is live - enjoy the game!'
    } else {
        '   Page loading - wait up to 30s on first visit'
    }
    Write-Colored "  |" -Color Green -NoNewline
    Write-Colored $hintLine.PadRight($innerWidth) -Color DarkGray -NoNewline
    Write-Colored "|" -Color Green

    Write-Colored "  |$blank|" -Color Green
    Write-Colored "  \$bar/" -Color Green
    Write-Host ""

} catch {
    Show-ErrorBox -Title "Launch failed" -Lines @(
        $_.Exception.Message,
        '',
        "You can also open the game manually at:",
        $GAME_URL
    )
    exit 1
}
