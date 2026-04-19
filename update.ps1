#Requires -Version 5.1
Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding           = [System.Text.Encoding]::UTF8
Set-Location $PSScriptRoot

# ─── Script-scope state ───────────────────────────────────────────────────────
$script:UseAnsi    = $false
$script:ESC        = [char]27
$script:TermWidth  = 52
$script:AnsiColors = @{}
$script:StashRef   = $null
$script:BackupTag  = $null
$script:OldHash    = $null
$script:NewHash    = $null
$script:GitVersion = ''

# ─── ANSI initialisation ──────────────────────────────────────────────────────
function Initialize-Ansi {
    $isModern = ($null -ne $env:WT_SESSION) -or ($env:TERM_PROGRAM -eq 'vscode')
    if (-not $isModern -and $Host.Name -eq 'ConsoleHost') {
        try {
            $k32 = Add-Type -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint m);
[DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint m);
[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int n);
'@ -Name K32Upd -Namespace Win32VTUpd -PassThru -ErrorAction Stop
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

# ─── Box rendering ────────────────────────────────────────────────────────────
function New-Box {
    param(
        [string[]]$Lines,
        [string]$BorderColor  = 'Cyan',
        [string]$Style        = 'Double',
        [string]$ContentColor = 'White',
        [int]$InnerWidth      = 0
    )
    if ($Style -eq 'Double') {
        $tl='╔'; $tr='╗'; $bl='╚'; $br='╝'; $h='═'; $v='║'
    } else {
        $tl='┌'; $tr='┐'; $bl='└'; $br='┘'; $h='─'; $v='│'
    }
    if ($InnerWidth -lt 1) {
        $maxLen = ($Lines | ForEach-Object { $_.Length } | Measure-Object -Maximum).Maximum
        $InnerWidth = [Math]::Max(48, $maxLen + 2)
        $InnerWidth = [Math]::Min($InnerWidth, $script:TermWidth - 4)
    }
    $bar = $h * $InnerWidth
    Write-Colored "  $tl$bar$tr" -Color $BorderColor
    foreach ($line in $Lines) {
        $padded = $line.PadRight($InnerWidth)
        if ($padded.Length -gt $InnerWidth) { $padded = $padded.Substring(0, $InnerWidth) }
        Write-Colored "  $v" -Color $BorderColor -NoNewline
        Write-Colored $padded -Color $ContentColor -NoNewline
        Write-Colored $v -Color $BorderColor
    }
    Write-Colored "  $bl$bar$br" -Color $BorderColor
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
        Write-Colored "  ...  $Description" -Color Cyan
        try {
            & $Action
            Write-Colored "  ✓  $Description" -Color Green
            return $true
        } catch {
            if ($WarnOnFailure) { Write-Colored "  ⚠  $Description" -Color Yellow; return $false }
            Write-Colored "  ✗  $Description" -Color Red
            throw
        }
    }

    $frames = [char[]]@([char]0x25D0,[char]0x25D3,[char]0x25D1,[char]0x25D2)
    Write-Host "  $($frames[0])  $Description"
    $row = $Host.UI.RawUI.CursorPosition.Y - 1

    $state = [hashtable]::Synchronized(@{
        Row       = $row
        Idx       = 0
        Desc      = $Description
        Done      = $false
        UseAnsi   = $script:UseAnsi
        CyanCode  = if ($script:UseAnsi) { $script:AnsiColors['Cyan'] } else { '' }
        ResetCode = if ($script:UseAnsi) { $script:AnsiColors['Reset'] } else { '' }
        Frames    = $frames
    })

    $timerCallback = [System.Threading.TimerCallback]{
        param($s)
        if ($s.Done) { return }
        $f = $s.Frames[$s.Idx % 4]
        $s.Idx++
        $msg = "  $f  $($s.Desc)          "
        try {
            [Console]::SetCursorPosition(0, $s.Row)
            if ($s.UseAnsi) { [Console]::Write("$($s.CyanCode)$msg$($s.ResetCode)") }
            else             { [Console]::Write($msg) }
        } catch { }
    }

    $timer = New-Object System.Threading.Timer($timerCallback, $state, 0, 100)

    try {
        & $Action
        $state.Done = $true
        $timer.Dispose()
        try { [Console]::SetCursorPosition(0, $row) } catch { }
        Write-Colored "  ✓  $Description                              " -Color Green
        return $true
    } catch {
        $state.Done = $true
        $timer.Dispose()
        try { [Console]::SetCursorPosition(0, $row) } catch { }
        if ($WarnOnFailure) {
            Write-Colored "  ⚠  $Description                              " -Color Yellow
            return $false
        }
        Write-Colored "  ✗  $Description                              " -Color Red
        throw
    }
}

# ─── Title card ───────────────────────────────────────────────────────────────
function Show-TitleCard {
    Clear-Host
    $e          = $script:ESC
    $innerWidth = 50
    $bar        = '═' * $innerWidth
    $blank      = ' ' * $innerWidth

    Write-Colored "  ╔$bar╗" -Color Cyan
    Write-Colored "  ║$blank║" -Color Cyan

    $title   = '⚔  THE FORGOTTEN REALM  ⚔'
    $pad     = [Math]::Max(0, [int](($innerWidth - $title.Length) / 2))
    $titleLine = (' ' * $pad) + $title
    $titleLine = $titleLine.PadRight($innerWidth)
    Write-Colored "  ║" -Color Cyan -NoNewline
    if ($script:UseAnsi) {
        [Console]::Write("$e[93m$e[1m$titleLine$e[0m")
        Write-Colored "║" -Color Cyan
    } else {
        Write-Host $titleLine -ForegroundColor Yellow -NoNewline
        Write-Colored "║" -Color Cyan
    }

    $sub     = 'Update Manager'
    $subPad  = [Math]::Max(0, [int](($innerWidth - $sub.Length) / 2))
    $subLine = (' ' * $subPad) + $sub
    $subLine = $subLine.PadRight($innerWidth)
    Write-Colored "  ║" -Color Cyan -NoNewline
    Write-Colored $subLine -Color DarkCyan -NoNewline
    Write-Colored "║" -Color Cyan

    Write-Colored "  ║$blank║" -Color Cyan
    Write-Colored "  ╚$bar╝" -Color Cyan
    Write-Host ""
}

# ─── Error box ────────────────────────────────────────────────────────────────
function Show-ErrorBox {
    param([string]$Title, [string[]]$Lines)
    $innerWidth = 50
    $bar        = '─' * $innerWidth
    $titleFull  = "── $Title "
    $titleFull  = $titleFull.PadRight($innerWidth, '─')
    Write-Colored "  ┌$titleFull┐" -Color Red
    foreach ($line in ($Lines | Select-Object -Last 10)) {
        if ($null -eq $line) { $line = '' }
        $padded = "  $line"
        if ($padded.Length -gt $innerWidth) { $padded = $padded.Substring(0, $innerWidth - 3) + '...' }
        $padded = $padded.PadRight($innerWidth)
        Write-Colored "  │" -Color Red -NoNewline
        Write-Colored $padded -Color White -NoNewline
        Write-Colored "│" -Color Red
    }
    Write-Colored "  └$bar┘" -Color Red
    Write-Host ""
}

# ─── Rollback menu ────────────────────────────────────────────────────────────
function Show-RollbackMenu {
    Show-TitleCard
    Write-Colored "  Recent backups:" -Color Yellow
    Write-Host ""

    $rawTags = & git tag --list 'backup-*' 2>&1
    $tagList = @($rawTags | Where-Object { $_ -match '\S' } | Sort-Object -Descending | Select-Object -First 5)

    if ($tagList.Count -eq 0) {
        Write-Colored "  ✗  No backup tags found. Run update.bat first to create one." -Color Red
        Write-Host ""
        return
    }

    $now = [DateTime]::Now
    for ($i = 0; $i -lt $tagList.Count; $i++) {
        $tag     = $tagList[$i]
        $dateStr = ''
        if ($tag -match 'backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})') {
            try {
                $dt   = [DateTime]::new([int]$Matches[1],[int]$Matches[2],[int]$Matches[3],
                                        [int]$Matches[4],[int]$Matches[5],[int]$Matches[6])
                $diff = $now - $dt
                if    ($diff.TotalDays -lt 1) { $dateStr = "today, $($dt.ToString('h:mm tt'))" }
                elseif($diff.TotalDays -lt 2) { $dateStr = "yesterday, $($dt.ToString('h:mm tt'))" }
                else                          { $dateStr = "$([int][Math]::Floor($diff.TotalDays)) days ago" }
            } catch { }
        }
        $label = if ($dateStr) { "  [$($i+1)]  $tag  ($dateStr)" } else { "  [$($i+1)]  $tag" }
        Write-Colored $label -Color White
    }

    Write-Host ""
    Write-Colored "  Enter number to restore, or [C] to cancel: " -Color Yellow -NoNewline
    $choice = Read-Host
    Write-Host ""

    if ($choice -match '^[Cc]$') {
        Write-Colored "  ◼  Rollback cancelled." -Color DarkGray
        Write-Host ""
        return
    }

    $idx = 0
    if (-not [int]::TryParse($choice, [ref]$idx) -or $idx -lt 1 -or $idx -gt $tagList.Count) {
        Write-Colored "  ✗  Invalid selection." -Color Red
        Write-Host ""
        return
    }

    $selectedTag = $tagList[$idx - 1]
    Invoke-WithSpinner -Description "Restoring $selectedTag" -Action {
        $out = & git checkout $selectedTag 2>&1
        if ($LASTEXITCODE -ne 0) { throw "git checkout failed: $out" }
    } | Out-Null

    Write-Host ""
    $innerWidth = 50
    $bar        = '═' * $innerWidth
    $blank      = ' ' * $innerWidth
    $e          = $script:ESC
    Write-Colored "  ╔$bar╗" -Color Green
    Write-Colored "  ║$blank║" -Color Green
    $l1 = "   ✓  Rolled back to: $selectedTag"
    Write-Colored "  ║" -Color Green -NoNewline
    if ($script:UseAnsi) {
        [Console]::Write("$e[92m$e[1m$($l1.PadRight($innerWidth))$e[0m")
        Write-Colored "║" -Color Green
    } else {
        Write-Host $l1.PadRight($innerWidth) -ForegroundColor Green -NoNewline
        Write-Colored "║" -Color Green
    }
    $l2 = "   Run launch.bat to play this version"
    Write-Colored "  ║" -Color Green -NoNewline
    Write-Colored $l2.PadRight($innerWidth) -Color DarkGray -NoNewline
    Write-Colored "║" -Color Green
    Write-Colored "  ║$blank║" -Color Green
    Write-Colored "  ╚$bar╝" -Color Green
    Write-Host ""
}

# ─── Entry point ──────────────────────────────────────────────────────────────
Initialize-Ansi
$script:TermWidth = Get-TerminalWidth

if ($args -contains '--rollback') {
    Show-RollbackMenu
    exit 0
}

Show-TitleCard

try {

    # ── Step 1 — Git check ────────────────────────────────────────────────────
    Invoke-WithSpinner -Description "Checking Git installation" -Action {
        $out = & git --version 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Git not found — install from https://git-scm.com" }
        $script:GitVersion = ($out -replace 'git version\s*', '').Trim()
    } | Out-Null
    try {
        $row = $Host.UI.RawUI.CursorPosition.Y - 1
        [Console]::SetCursorPosition(0, $row)
        Write-Colored "  ✓  Git $($script:GitVersion) detected                                    " -Color Green
    } catch { }

    # ── Step 2 — Repo check ───────────────────────────────────────────────────
    Invoke-WithSpinner -Description "Verifying repository" -Action {
        $out = & git rev-parse --git-dir 2>&1
        if ($LASTEXITCODE -ne 0) { throw "Not a git repository — is this the right folder?" }
    } | Out-Null

    # ── Step 3 — Connectivity check ───────────────────────────────────────────
    Invoke-WithSpinner -Description "Checking GitHub connectivity" -Action {
        $ok = Test-NetConnection -ComputerName github.com -Port 443 `
              -InformationLevel Quiet -WarningAction SilentlyContinue
        if (-not $ok) { throw "Cannot reach GitHub — check your internet connection" }
    } | Out-Null

    Write-Host ""

    # ── Step 4 — Stash local changes ──────────────────────────────────────────
    $statusLines = @(& git status --porcelain 2>&1 | Where-Object { $_ -match '\S' })

    if ($statusLines.Count -gt 0) {
        Write-Colored "  ⚠  You have local changes that would be overwritten." -Color Yellow
        Write-Host ""

        $displayLines = if ($statusLines.Count -gt 8) { $statusLines[0..7] } else { $statusLines }
        foreach ($l in $displayLines) {
            Write-Colored "     $l" -Color DarkGray
        }
        if ($statusLines.Count -gt 8) {
            Write-Colored "     ...and $($statusLines.Count - 8) more" -Color DarkGray
        }

        Write-Host ""
        Write-Colored "  [S] Stash them and restore after update" -Color White
        Write-Colored "  [D] Discard them and update clean" -Color White
        Write-Colored "  [C] Cancel" -Color White
        Write-Host ""
        Write-Colored "  Choice [S/D/C]: " -Color Yellow -NoNewline

        $key = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
        [Console]::WriteLine($key.Character)
        Write-Host ""

        switch ($key.Character.ToString().ToUpper()) {
            'S' {
                Invoke-WithSpinner -Description "Stashing local changes" -Action {
                    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
                    $out   = & git stash push -m "pre-update-$stamp" 2>&1
                    if ($LASTEXITCODE -ne 0) { throw "git stash failed: $($out -join ' ')" }
                    $script:StashRef = 'stash@{0}'
                } | Out-Null
            }
            'D' {
                Invoke-WithSpinner -Description "Discarding local changes" -Action {
                    $out = & git checkout -- . 2>&1
                    if ($LASTEXITCODE -ne 0) { throw "git checkout failed: $($out -join ' ')" }
                } | Out-Null
            }
            'C' {
                Write-Host ""
                Write-Colored "  ◼  Update cancelled." -Color DarkGray
                Write-Host ""
                exit 0
            }
            default {
                throw "Invalid choice '$($key.Character)' — update cancelled."
            }
        }
    } else {
        Write-Colored "  ✓  Working directory clean                              " -Color Green
    }

    Write-Host ""

    # ── Step 5 — Create backup tag ────────────────────────────────────────────
    $script:OldHash = (& git rev-parse --short HEAD 2>&1).Trim()

    Invoke-WithSpinner -Description "Creating rollback backup" -Action {
        $script:BackupTag = "backup-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
        $out = & git tag $script:BackupTag 2>&1
        if ($LASTEXITCODE -ne 0) { throw "git tag failed: $($out -join ' ')" }
    } | Out-Null
    try {
        $row = $Host.UI.RawUI.CursorPosition.Y - 1
        [Console]::SetCursorPosition(0, $row)
        Write-Colored "  ✓  Backup created: $($script:BackupTag)                       " -Color Green
    } catch { }
    Write-Colored "     Rollback anytime with: git checkout $($script:BackupTag)" -Color DarkGray

    Write-Host ""

    # ── Step 6 — Fetch and compare ────────────────────────────────────────────
    $branch = (& git branch --show-current 2>&1).Trim()

    Invoke-WithSpinner -Description "Fetching latest from origin" -Action {
        $out = & git fetch origin --no-progress 2>&1
        if ($LASTEXITCODE -ne 0) { throw "git fetch failed: $($out -join ' ')" }
    } | Out-Null

    $LOCAL  = (& git rev-parse HEAD 2>&1).Trim()
    $REMOTE = (& git rev-parse "@{u}" 2>&1).Trim()

    if ($LOCAL -eq $REMOTE) {
        $ver = (& git describe --tags --always 2>&1).Trim()
        Write-Host ""
        $innerWidth = 50
        $bar        = '═' * $innerWidth
        $blank      = ' ' * $innerWidth
        $e          = $script:ESC
        Write-Colored "  ╔$bar╗" -Color Green
        Write-Colored "  ║$blank║" -Color Green
        $l1 = "   ✓  You're already on the latest version!"
        Write-Colored "  ║" -Color Green -NoNewline
        if ($script:UseAnsi) {
            [Console]::Write("$e[92m$e[1m$($l1.PadRight($innerWidth))$e[0m")
            Write-Colored "║" -Color Green
        } else {
            Write-Host $l1.PadRight($innerWidth) -ForegroundColor Green -NoNewline
            Write-Colored "║" -Color Green
        }
        $l2 = "   Version: $ver"
        Write-Colored "  ║" -Color Green -NoNewline
        Write-Colored $l2.PadRight($innerWidth) -Color DarkCyan -NoNewline
        Write-Colored "║" -Color Green
        Write-Colored "  ║$blank║" -Color Green
        Write-Colored "  ╚$bar╝" -Color Green
        Write-Host ""
        exit 0
    }

    # Count and preview incoming commits
    $commitCountStr = (& git rev-list HEAD..origin/$branch --count 2>&1).Trim()
    $commitCount    = 0
    [int]::TryParse($commitCountStr, [ref]$commitCount) | Out-Null
    $commitMsgs = @(& git log HEAD..origin/$branch --oneline --pretty=format:'• %s' 2>&1 |
                    Select-Object -First 5)

    Write-Host ""
    $plural = if ($commitCount -ne 1) { 's' } else { '' }
    Write-Colored "  ◼  $commitCount update$plural available:" -Color Yellow
    foreach ($msg in $commitMsgs) {
        Write-Colored "     $msg" -Color DarkGray
    }
    $extra = $commitCount - $commitMsgs.Count
    if ($extra -gt 0) { Write-Colored "     ...and $extra more" -Color DarkGray }
    Write-Host ""

    # ── Step 7 — Pull ─────────────────────────────────────────────────────────
    Invoke-WithSpinner -Description "Pulling latest code" -Action {
        $out = & git pull origin $branch --no-progress 2>&1
        if ($LASTEXITCODE -ne 0) { throw ($out -join "`n") }
    } | Out-Null

    $script:NewHash = (& git rev-parse --short HEAD 2>&1).Trim()

    # ── Step 8 — Dependency update ────────────────────────────────────────────
    $reqPath = Join-Path $PSScriptRoot 'requirements.txt'
    if (Test-Path $reqPath) {
        $reqBefore = ''
        try { $reqBefore = (& git show HEAD@{1}:requirements.txt 2>&1 | Out-String).Trim() } catch { }
        $reqAfter = (Get-Content $reqPath -Raw -ErrorAction SilentlyContinue).Trim()

        if ($reqBefore -ne $reqAfter -and $reqAfter -ne '') {
            Invoke-WithSpinner -Description "Installing updated dependencies" -Action {
                $venvPy = Join-Path $PSScriptRoot 'venv\Scripts\python.exe'
                if (-not (Test-Path $venvPy)) { $venvPy = 'python' }
                $tmpErr = [System.IO.Path]::GetTempFileName()
                $proc = Start-Process -FilePath $venvPy `
                    -ArgumentList "-m pip install -r `"$reqPath`" -q --disable-pip-version-check" `
                    -NoNewWindow -Wait -PassThru -RedirectStandardError $tmpErr `
                    -WorkingDirectory $PSScriptRoot
                if ($proc.ExitCode -ne 0) {
                    $errOut = Get-Content $tmpErr -ErrorAction SilentlyContinue | Select-Object -Last 5
                    Remove-Item $tmpErr -Force -ErrorAction SilentlyContinue
                    throw "pip install failed:`n$($errOut -join "`n")"
                }
                Remove-Item $tmpErr -Force -ErrorAction SilentlyContinue
                # Bust the launch.ps1 dependency cache so it re-validates next run
                $cachePath = Join-Path $PSScriptRoot '.deps-installed'
                if (Test-Path $cachePath) { Remove-Item $cachePath -Force -ErrorAction SilentlyContinue }
            } | Out-Null
        } else {
            Write-Colored "  ✓  Dependencies unchanged — skipping install               " -Color Green
        }
    }

    # ── Step 9 — Restore stash ────────────────────────────────────────────────
    if ($null -ne $script:StashRef) {
        Write-Host ""
        Invoke-WithSpinner -Description "Restoring local changes" -Action {
            $out = & git stash pop 2>&1
            if ($LASTEXITCODE -ne 0) { throw ($out -join "`n") }
        } -WarnOnFailure | Out-Null

        # Detect merge conflicts left by stash pop
        $conflicts = @(& git status --porcelain 2>&1 | Where-Object { $_ -match '^(UU|AA|DD|AU|UA|DU|UD)' })
        if ($conflicts.Count -gt 0) {
            Write-Host ""
            $innerWidth = 50
            $bar        = '─' * $innerWidth
            $titleFull  = '── Merge Conflict '.PadRight($innerWidth, '─')
            Write-Colored "  ┌$titleFull┐" -Color Yellow
            $warnLines = @(
                '  Your local changes conflict with the update.',
                "  Your changes are in the stash: $($script:StashRef)",
                '  Resolve manually with: git stash pop'
            )
            foreach ($wl in $warnLines) {
                $padded = $wl.PadRight($innerWidth)
                Write-Colored "  │" -Color Yellow -NoNewline
                Write-Colored $padded -Color White -NoNewline
                Write-Colored "│" -Color Yellow
            }
            Write-Colored "  └$bar┘" -Color Yellow
            Write-Host ""
        }
    }

    # ── Step 10 — Success banner ──────────────────────────────────────────────
    $filesChanged = ''
    try {
        $diffOut = & git diff --stat HEAD@{1} HEAD 2>&1
        $lastLine = ($diffOut | Select-Object -Last 1).Trim()
        if ($lastLine -match '(\d+ file)') { $filesChanged = $lastLine }
    } catch { }

    Write-Host ""
    $innerWidth = 50
    $bar        = '═' * $innerWidth
    $blank      = ' ' * $innerWidth
    $e          = $script:ESC

    Write-Colored "  ╔$bar╗" -Color Cyan
    Write-Colored "  ║$blank║" -Color Cyan

    $doneTitle = '   ✓  Update complete!'
    Write-Colored "  ║" -Color Cyan -NoNewline
    if ($script:UseAnsi) {
        [Console]::Write("$e[92m$e[1m$($doneTitle.PadRight($innerWidth))$e[0m")
        Write-Colored "║" -Color Cyan
    } else {
        Write-Host $doneTitle.PadRight($innerWidth) -ForegroundColor Green -NoNewline
        Write-Colored "║" -Color Cyan
    }

    Write-Colored "  ║$blank║" -Color Cyan

    $vLine = "   Version:   $($script:OldHash) → $($script:NewHash)"
    Write-Colored "  ║" -Color Cyan -NoNewline
    Write-Colored $vLine.PadRight($innerWidth) -Color White -NoNewline
    Write-Colored "║" -Color Cyan

    if ($filesChanged) {
        $fLine = "   Updated:   $filesChanged"
        Write-Colored "  ║" -Color Cyan -NoNewline
        Write-Colored $fLine.PadRight($innerWidth) -Color White -NoNewline
        Write-Colored "║" -Color Cyan
    }

    $bLine = "   Backup:    $($script:BackupTag)"
    Write-Colored "  ║" -Color Cyan -NoNewline
    Write-Colored $bLine.PadRight($innerWidth) -Color DarkCyan -NoNewline
    Write-Colored "║" -Color Cyan

    Write-Colored "  ║$blank║" -Color Cyan

    $playLine = '   Run launch.bat to play'
    Write-Colored "  ║" -Color Cyan -NoNewline
    Write-Colored $playLine.PadRight($innerWidth) -Color DarkGray -NoNewline
    Write-Colored "║" -Color Cyan

    Write-Colored "  ║$blank║" -Color Cyan
    Write-Colored "  ╚$bar╝" -Color Cyan
    Write-Host ""

} catch {
    $rollbackHint = if ($script:BackupTag) { $script:BackupTag } else { '<none>' }
    Show-ErrorBox -Title "Update failed" -Lines @(
        $_.Exception.Message,
        '',
        "To rollback: git checkout $rollbackHint",
        'Or run:      update.bat --rollback'
    )
    exit 1
}
