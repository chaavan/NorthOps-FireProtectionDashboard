/**
 * Generates the downloadable PowerShell watcher (+ a .bat launcher) for a
 * HydraTec watcher key. Unlike the original design (a Scheduled Task firing
 * a new powershell.exe every minute - which flashed a console window each
 * time), this is a single persistent process: a Windows Forms system tray
 * icon with an internal 60-second timer. A shortcut in the user's Startup
 * folder launches this once at login; the process itself stays alive and
 * ticks internally until the user exits it from the tray menu. (A Scheduled
 * Task with an AtLogOn trigger was tried first, but Register-ScheduledTask
 * returns "Access is denied" for AtLogOn triggers without admin elevation
 * on this kind of setup - a Startup-folder shortcut needs no special
 * permissions at all.)
 *
 * Written for compatibility with Windows PowerShell 5.1 (the default
 * `powershell.exe` on most Windows PCs), NOT just PowerShell 7+/pwsh:
 *  - `Invoke-RestMethod -Form` (multipart helper) doesn't exist before 6.1,
 *    so the multipart/form-data body is built by hand.
 *  - `ConvertFrom-Json -AsHashtable` doesn't exist before 6.0, so processed-
 *    file tracking uses a plain JSON array instead of a hashtable.
 */

/**
 * Two small (32x32) PNG variants of the flame logo (derived from
 * public/estimate-logo.png), embedded as Base64 so the generated script is
 * fully self-contained - no separate icon file to download or go missing.
 * Decoded into System.Drawing.Icon objects at runtime via Bitmap.GetHicon().
 */
const CONNECTED_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAPcSURBVFiFxZffa1xVEMc/c+7d3aT5xSZlE6LVKrSYloJQa0t8EIuIIlRbEF/74B/gf+WT+tAnUZQ+iA+ihZSKoMWSBqxJ2m6bTbrb3Tvjw/19997srSAdOHt+zJnvzJmZO+esvLT2lvEcyZmF+qv6w3h1ZCdhOBEBoKo/jFdHdhKGo8Ta2lSUfRas2AOUWFubirLPgpV44DnTWBLWoTpJVxdjLAnrUJ2kq4sResAMyzSM3JgcL7/XM7jwsJxPCZYV+KEHRJBMQ8iNyfHSsRPhsz9H3Fgo51OCJQW+b2YIgmE594TrofJ4bJDbu74T4BQGEp2uwC9zexHLT+KIjG0ei3k8j0avHIRAVPAPi328w1khpnXbsL3CUByegkRr649lLEcmNSeF+NdtdI7zaDosJC8MwrXfZ+DkPhUy5ev/zQNAd36ZH5d8AD7cDBAzHjjlnb8DnJbIqGGm4x6I45GN2qQ5gPotuksd1IOGGm88VAzwAljpx3U+lbUSrPBLipNIJGVOmI/mjjJyPttrb/Ptix5icGHbuHpH8QzOPAoT0ZmwOihikczDJIScayfN1Wuwe/oiAOY8fnrzXTaWwkt1Pjr58Z4iGIpx/r6GiRldgDnsJAQVn2KRtDHF9vkrqOcna/2FZb784DK/dPzEzc0RtIdCy2B1T/ET/4+XcEf2UqkoIABBa5adcx+jzkOwXAta01x77xK3216y/6OtgMubAWLQtAg9U45jvX5ikVla9aK5JdYK919/n87PX9NfOYFhHLn3B08WVtDpOSQY4T/d56tzp/n8uw2aCrMDYxYwAUd6Yino8bMeoOR69QyCRhNtNNk5e4mR3wSg9c9f7HdO8HRxBR9BBj20Nc3NpVuc3Qly3utLAXfMA0ltzvehAYaIQxE0Uh7LuAh4hEFrBgHuTeXzaGtWGEWAkpGN9YQ5EDGKPcBQ4NheH9H8qQzQQp7MDPZ4tae5PT90XCW+xQZkLSuSAi/vBSzf+j59SGqA04DWfjeMaeSp9q/fcLKbGrCxKHQbKVb8lWX1ybHX1ie+p1oKn24qX5w6ytaZi5jnI9E5RBxeb5dTN65z5fYTGpGj7swL11YzpzdNTcjetFUGmCki6Zu1PYRPNpXdFmzNNejNHGFqGLDYO+D4Y2V6GN7zQw+uLzt+m5ccVs4HRQOkEHcA0yAUcPmH82rfWOsq8yNhSg0V4cDBng8328KDpuSwTDXKQAnVJ/U4/A0/wzIXRLVAg1FYoEzB4K4Hd5eqggUM4+A6hMzTrCTDLDagXL8jMfh/pPSvWVV/GK+O7ASM9K9ZVX8Yr47sBIx/AZmFz+5rrqKeAAAAAElFTkSuQmCC';

const DISCONNECTED_ICON_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAMTSURBVFiFxZbPaixFFMZ/51RVTwYyDMkkkYuCCL6DbyHizqXgRu4bCeLajQt9AH0OceHqoouBJBAm6e6qcxep7tuZme6uCYIfNF1FVZ3z9VfnT8vNzY3xP0LNnv2PvafWSs7O2VARAWDsPbVWcnbOhh5jW4r9s6fYOlDgNdg/e4qtXoFXe/+PcBCEJSgJulIbB0FYgpKgK7Xhj7EXkZ7hcDxmyHtP0zSj61O2/Bj7Y2l4DCEEmqaZ3DNly5vZAbMp1sO5cw4zG10/RmR/rx+7xynWfQqpzp6dUoOxGCjBYrEgpdTPzYyqqqjr+iQ7ozEwh+VyycPDA2QlUkrEGHHOvSA2S+A1CogIzrne4ZBAVVXEGIttvboSqiohhP5OnXOQr2IsNo59iHaD/aCbmnvvAVitVr3cqkpVVf14SGzKlnas9/v/2FxEWK/X/fj8/Lxf78trVqBTY8yWmX1QoEQyVeXq6urFvhAC6/X6wIlTJXiPE2ERAiHHyr6/XgFmmopzjs1mM0qsVwVwIgTn8Kq8UeUj5/DOsfCeKl9f588zqFD77yHbi4sLttsty+USgN1uRwgB7z1mRkqJqqqQtgXgmxD40nuu8vl/zPitbfm5rqlUeci9Q66vryfzUERQVS4vL3tyANvtltVq9exUhBgjzdMTqWn44eyMz/R4gv2VEt8/PlLHSN22ZWk49Z/YSSkiNHXNdyGMOgf4XJVvQ8DlTCmuA3P/f7FtEeCrEGZtfZ33ONV5Ap2j+/v7g7VhxYttyyeqLGbdwxnwRhUtVSDGiJlxe3vbE9psNn1Atm1LXdeUd4DnbAHwM/sgqxBjxHvP3d0d5NR7UXxEeJcSj/kLp/AEvEvpQyEaczq855QSdV0TY+wbz7B+pJQw4NeRX7Mhfsl7UlcHjqGrBftFaqzViggaAj82DV94z6cjVfVvM35qGlImPRkDXePoasHUIyLUMZLMeLvb8ceRlvx7jLzd7Uhm1G2LlRSiUyG5DDtVzkT4WIQW+NeMRzNiSjSD6ysKwlNg+etUlVaEP/NVmBkxyz7Ee18t5bCnYqV+AAAAAElFTkSuQmCC';

/**
 * "localhost" resolves to both ::1 (IPv6) and 127.0.0.1 (IPv4) on Windows.
 * A dev server bound only to the IPv4 wildcard (e.g. `next dev`'s default
 * 0.0.0.0:PORT) has no IPv6 listener, so PowerShell's HTTP client can
 * flakily pick ::1 first and fail to connect - inconsistently, depending on
 * resolver order. "0.0.0.0" itself is a bind-only wildcard address, not a
 * valid address to connect to, and always fails. Both get normalized to the
 * unambiguous 127.0.0.1. No-op for any real deployed hostname.
 */
export function normalizeApiBaseUrlForWatcherScript(apiBaseUrl: string): string {
  try {
    const url = new URL(apiBaseUrl);
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '0.0.0.0') {
      url.hostname = '127.0.0.1';
      return url.origin;
    }
    return apiBaseUrl;
  } catch {
    return apiBaseUrl;
  }
}

export function buildWatcherScriptFileName(watcherName: string): string {
  const slug = watcherName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `hydratec-watcher-${slug || 'watcher'}.ps1`;
}

/**
 * Escapes a value for safe interpolation inside a PowerShell *single-quoted*
 * string literal. In PowerShell, a single quote is escaped by doubling it
 * (`''`) — without this, a watcher name like "Chaavan's Test PC" closes the
 * string early and breaks the script with a parse error before anything in
 * it ever runs.
 */
function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

export function buildHydraTecWatcherScript(params: {
  apiBaseUrl: string;
  secret: string;
  watcherName: string;
}): string {
  const apiBaseUrl = escapePowerShellSingleQuoted(params.apiBaseUrl);
  const secret = escapePowerShellSingleQuoted(params.secret);
  const watcherName = escapePowerShellSingleQuoted(params.watcherName);
  const watcherNameForComment = params.watcherName;

  return `# HydraTec Watcher - ${watcherNameForComment}
# Generated by Total Fire Protection dashboard. Do not share this file - it
# contains a credential that lets this script upload HydraTec exports.
#
# What this does:
#  - Shows a system tray icon (look for the flame near your clock)
#  - Adds itself to Startup so it launches automatically next login
#  - Checks in with the dashboard and scans for new *.hvuf files every
#    60 seconds for as long as it keeps running
#  - Right-click the tray icon for status, pause/resume, and to uninstall
#
# Don't double-click this .ps1 directly - use the matching .bat file that
# was downloaded alongside it. Double-clicking a .ps1 downloaded from a
# browser is blocked by Windows on most PCs.

param([switch]$Silent)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ApiBaseUrl = '${apiBaseUrl}'
$ApiKey = '${secret}'
$WatchFolder = Join-Path $env:USERPROFILE 'Documents\\HydraTec Exports'
$ScriptPath = $MyInvocation.MyCommand.Path
$StateDir = Split-Path -Parent $ScriptPath
$ProcessedFile = Join-Path $StateDir 'processed.json'
$LogFile = Join-Path $StateDir 'watcher-log.txt'
$ShortcutName = ('HydraTecWatcher_${watcherName}').Replace(' ', '_') + '.lnk'
$ShortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) $ShortcutName
$WatchdogTaskName = ('HydraTecWatcherWatchdog_${watcherName}').Replace(' ', '_')
$CRLF = [string]([char]13) + [string]([char]10)
$WatcherDisplayName = '${watcherName}'

# Refuse to start a second copy of this same watcher - two instances would
# both poll the same folder and read/write the same processed.json at once,
# re-introducing race conditions (and showing two redundant tray icons).
$MutexName = 'Global\TotalFireHydraTecWatcher_' + ('${watcherName}').Replace(' ', '_')
$mutexCreatedNew = $false
try {
  $script:SingleInstanceMutex = New-Object System.Threading.Mutex($true, $MutexName, [ref]$mutexCreatedNew)
} catch {
  $mutexCreatedNew = $true
}
if (-not $mutexCreatedNew) {
  # The watchdog task (see Ensure-WatchdogTask) launches with -Silent every
  # few minutes specifically EXPECTING this to be the common case (the
  # watcher already running healthily) - showing an interactive MessageBox
  # here would block forever with nothing to dismiss it, leaking one stuck
  # zombie process per watchdog cycle. Only show it for a real interactive
  # double-click (no -Silent), where "already running" is useful feedback.
  if (-not $Silent) {
    [System.Windows.Forms.MessageBox]::Show(
      "HydraTec Watcher ($WatcherDisplayName) is already running - look for the flame icon near your clock.",
      'HydraTec Watcher',
      [System.Windows.Forms.MessageBoxButtons]::OK,
      [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
  }
  exit 0
}

$script:IsPaused = $false

function Write-Log($message) {
  $line = "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $message"
  Add-Content -Path $LogFile -Value $line
}

function New-IconFromBase64($base64) {
  $bytes = [Convert]::FromBase64String($base64)
  $memoryStream = New-Object System.IO.MemoryStream(, $bytes)
  $bitmap = [System.Drawing.Bitmap]::FromStream($memoryStream)
  return [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
}

$ConnectedIcon = New-IconFromBase64 '${CONNECTED_ICON_BASE64}'
$DisconnectedIcon = New-IconFromBase64 '${DISCONNECTED_ICON_BASE64}'

function Ensure-StartupShortcut {
  # A Startup-folder shortcut needs no admin rights, unlike Task Scheduler's
  # AtLogOn trigger (which returns "Access is denied" for a normal user on
  # many systems unless elevated). Cheap to just (re)write unconditionally
  # on every launch - keeps it self-healing with no separate "is this
  # outdated" check needed.
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = 'powershell.exe'
  $shortcut.Arguments = '-NoProfile -WindowStyle Hidden -STA -ExecutionPolicy Bypass -File "' + $ScriptPath + '"'
  $shortcut.WorkingDirectory = $StateDir
  $shortcut.Description = 'HydraTec Watcher - starts automatically at login'
  $shortcut.Save()
  Write-Log "Startup shortcut ready: $ShortcutPath"
}

function Ensure-WatchdogTask {
  # The Startup shortcut only fires once per login - if this process ever
  # crashes or gets closed mid-session (e.g. after a transient server
  # error), nothing brings it back until the next full login. This task
  # is the fix: it tries to (re)launch every 5 minutes, non-elevated (a
  # plain time-based trigger needs no admin rights, unlike AtLogOn - see
  # Ensure-StartupShortcut's note above). When an instance is already
  # running, the single-instance Mutex check at the top of this script
  # makes a duplicate launch attempt a harmless, invisible no-op.
  $existing = Get-ScheduledTask -TaskName $WatchdogTaskName -ErrorAction SilentlyContinue
  if ($existing) { return }

  # -Silent: see the comment at the mutex check above - this path is
  # expected to be a no-op most of the time, so it must never show UI.
  $argument = "-NoProfile -WindowStyle Hidden -STA -ExecutionPolicy Bypass -File '$ScriptPath' -Silent"
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 5)
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $WatchdogTaskName -Action $action -Trigger $trigger -Settings $settings -Description 'Relaunches the HydraTec watcher if it stops running, every 5 minutes.' | Out-Null
  Write-Log "Registered watchdog task '$WatchdogTaskName' (relaunches every 5 minutes if not already running)."
}

function Get-ProcessedList {
  if (Test-Path $ProcessedFile) {
    try {
      $parsed = Get-Content $ProcessedFile -Raw | ConvertFrom-Json
      if ($parsed) { return @($parsed) }
    } catch {
      Write-Log "Could not read processed.json, starting fresh: $($_.Exception.Message)"
    }
  }
  return @()
}

function Save-ProcessedList($list) {
  ConvertTo-Json -InputObject @($list) | Set-Content -Path $ProcessedFile
}

function Send-Checkin {
  $checkinUrl = "$ApiBaseUrl/api/job-imports/hydratec/watcher/checkin"
  try {
    Invoke-RestMethod -Uri $checkinUrl -Method Post -Headers @{ Authorization = "Bearer $ApiKey" } -TimeoutSec 15 | Out-Null
    return $true
  } catch {
    Write-Log "Checkin failed: $($_.Exception.Message)"
    return $false
  }
}

# Builds a multipart/form-data body by hand - Invoke-RestMethod's -Form
# parameter requires PowerShell 6.1+, but this needs to run on Windows
# PowerShell 5.1 (the default on most Windows PCs).
function Send-File($filePath) {
  try {
    $uploadUrl = "$ApiBaseUrl/api/job-imports/hydratec/watcher/upload"
    $fileName = Split-Path -Leaf $filePath
    $boundary = [System.Guid]::NewGuid().ToString()
    $latin1 = [System.Text.Encoding]::GetEncoding('ISO-8859-1')
    $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
    $fileContentAsLatin1 = $latin1.GetString($fileBytes)

    $dispositionLine = 'Content-Disposition: form-data; name="file"; filename="' + $fileName + '"'
    $bodyLines = @(
      ('--' + $boundary),
      $dispositionLine,
      'Content-Type: application/octet-stream',
      '',
      $fileContentAsLatin1,
      ('--' + $boundary + '--'),
      ''
    )
    $bodyString = $bodyLines -join $CRLF
    $bodyBytes = $latin1.GetBytes($bodyString)

    $response = Invoke-RestMethod -Uri $uploadUrl -Method Post -Headers @{ Authorization = "Bearer $ApiKey" } -ContentType ('multipart/form-data; boundary=' + $boundary) -Body $bodyBytes -TimeoutSec 60
    if ($response.skipped) {
      Write-Log "Skipped (already processed): $fileName - $($response.message)"
      return @{ Success = $true; Skipped = $true }
    }
    Write-Log "Uploaded: $fileName"
    return @{ Success = $true; Skipped = $false }
  } catch {
    $statusCode = $null
    if ($_.Exception.Response) { $statusCode = [int]$_.Exception.Response.StatusCode }
    if ($statusCode -eq 401) {
      Write-Log "Upload rejected (401 Unauthorized) - this key may have been revoked. Regenerate it from the dashboard."
    } else {
      Write-Log "Upload failed for $(Split-Path -Leaf $filePath): $($_.Exception.Message)"
    }
    return @{ Success = $false; Skipped = $false }
  }
}

# --- Tray icon setup ---

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = $ConnectedIcon
$notifyIcon.Text = "HydraTec Watcher - $WatcherDisplayName"
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$statusItem = $menu.Items.Add('Status: Starting...')
$statusItem.Enabled = $false
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$pauseItem = $menu.Items.Add('Pause')
$openFolderItem = $menu.Items.Add('Open Watch Folder')
$viewLogItem = $menu.Items.Add('View Log')
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$uninstallItem = $menu.Items.Add('Uninstall')
$exitItem = $menu.Items.Add('Exit')
$notifyIcon.ContextMenuStrip = $menu

function Update-StatusDisplay($connected) {
  if ($script:IsPaused) {
    $statusItem.Text = 'Status: Paused'
    $notifyIcon.Icon = $DisconnectedIcon
  } elseif ($connected) {
    $statusItem.Text = 'Status: Connected'
    $notifyIcon.Icon = $ConnectedIcon
  } else {
    $statusItem.Text = 'Status: Disconnected'
    $notifyIcon.Icon = $DisconnectedIcon
  }
}

$openFolderItem.Add_Click({
  if (-not (Test-Path $WatchFolder)) {
    New-Item -ItemType Directory -Path $WatchFolder -Force | Out-Null
  }
  Invoke-Item $WatchFolder
})

$viewLogItem.Add_Click({
  if (Test-Path $LogFile) {
    Invoke-Item $LogFile
  } else {
    [System.Windows.Forms.MessageBox]::Show('No log file yet - nothing has run since this was installed.', 'HydraTec Watcher') | Out-Null
  }
})

$pauseItem.Add_Click({
  $script:IsPaused = -not $script:IsPaused
  if ($script:IsPaused) {
    $pauseItem.Text = 'Resume'
    Write-Log 'Paused by user.'
  } else {
    $pauseItem.Text = 'Pause'
    Write-Log 'Resumed by user.'
  }
  Update-StatusDisplay (-not $script:IsPaused)
})

$uninstallItem.Add_Click({
  $confirm = [System.Windows.Forms.MessageBox]::Show(
    "Stop this watcher and remove it from starting at login? It won't run again until reinstalled from the dashboard.",
    'Uninstall HydraTec Watcher',
    [System.Windows.Forms.MessageBoxButtons]::YesNo
  )
  if ($confirm -eq [System.Windows.Forms.DialogResult]::Yes) {
    if (Test-Path $ShortcutPath) { Remove-Item $ShortcutPath -Force -ErrorAction SilentlyContinue }
    Unregister-ScheduledTask -TaskName $WatchdogTaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Log 'Uninstalled by user.'
    $notifyIcon.Visible = $false
    [System.Windows.Forms.Application]::Exit()
  }
})

$exitItem.Add_Click({
  Write-Log 'Exited by user (the watchdog task will relaunch this within ~5 minutes - use Uninstall to actually stop it).'
  $notifyIcon.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

function Run-Cycle {
  if ($script:IsPaused) { return }

  $checkinOk = Send-Checkin
  Update-StatusDisplay $checkinOk
  if (-not $checkinOk) { return }

  if (-not (Test-Path $WatchFolder)) {
    New-Item -ItemType Directory -Path $WatchFolder -Force | Out-Null
    Write-Log "Created watch folder: $WatchFolder"
  }

  # @(...) on both sides here is required, not decorative: PowerShell
  # collapses an empty array returned from a function into $null once
  # captured in a variable, and "$null += $key" silently produces a plain
  # STRING (not a 1-element array). Every following += then concatenates
  # strings instead of appending array elements, so dedup silently breaks
  # and every file re-uploads on every cycle.
  $processed = @(Get-ProcessedList)
  $files = Get-ChildItem -Path $WatchFolder -Filter '*.hvuf' -File -ErrorAction SilentlyContinue
  $changed = $false

  foreach ($file in $files) {
    $key = $file.Name + '|' + $file.LastWriteTimeUtc.Ticks
    if ($processed -contains $key) { continue }

    $result = Send-File $file.FullName
    if ($result.Success) {
      $processed = @($processed) + $key
      $changed = $true
      if ($result.Skipped) {
        $notifyIcon.ShowBalloonTip(4000, 'HydraTec Watcher', "Already processed: $($file.Name)", [System.Windows.Forms.ToolTipIcon]::Info)
      } else {
        $notifyIcon.ShowBalloonTip(4000, 'HydraTec Watcher', "Uploaded: $($file.Name)", [System.Windows.Forms.ToolTipIcon]::Info)
      }
    } else {
      $notifyIcon.ShowBalloonTip(4000, 'HydraTec Watcher', "Upload failed: $($file.Name) - see watcher-log.txt", [System.Windows.Forms.ToolTipIcon]::Warning)
    }
  }

  if ($changed) { Save-ProcessedList $processed }
}

Ensure-StartupShortcut
Ensure-WatchdogTask

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 60000
$timer.Add_Tick({
  try { Run-Cycle } catch { Write-Log "Cycle error: $($_.Exception.Message)" }
})
$timer.Start()

try { Run-Cycle } catch { Write-Log "Initial cycle error: $($_.Exception.Message)" }

[System.Windows.Forms.Application]::Run()
`;
}

export function buildHydraTecWatcherLauncherBat(params: { ps1FileName: string }): string {
  const { ps1FileName } = params;
  const batFileName = ps1FileName.replace(/\.ps1$/i, '.bat');

  return `@echo off
setlocal

REM This starts the watcher tray app, bypassing Windows' default block on
REM running unsigned scripts downloaded from a browser. Double-click this
REM file once - the first run also tidies itself away (along with the .ps1
REM and its log/state files) into a "Watcher" subfolder under your HydraTec
REM Exports folder, then keeps running from there. Look for the flame icon
REM near your clock once it's started.

set "TargetDir=%USERPROFILE%\\Documents\\HydraTec Exports\\Watcher"
set "Ps1Name=${ps1FileName}"
set "BatName=${batFileName}"

if /I not "%~dp0"=="%TargetDir%\\" (
  echo Moving HydraTec Watcher files into %TargetDir% ...
  if not exist "%TargetDir%" mkdir "%TargetDir%" >nul 2>nul
  if exist "%~dp0processed.json" move /Y "%~dp0processed.json" "%TargetDir%\\" >nul 2>nul
  if exist "%~dp0watcher-log.txt" move /Y "%~dp0watcher-log.txt" "%TargetDir%\\" >nul 2>nul
  if exist "%~dp0%Ps1Name%" move /Y "%~dp0%Ps1Name%" "%TargetDir%\\" >nul 2>nul
  copy /Y "%~f0" "%TargetDir%\\%BatName%" >nul
  REM "start \"\" \"path\\to.bat\"" opens an interactive /K shell instead of
  REM running it (at least in this environment) - explicitly forcing cmd /c
  REM (run-then-close) is what actually executes it.
  start "" cmd /c "%TargetDir%\\%BatName%"
  REM Deleting this .bat while it's still the one running fails ("batch file
  REM cannot be found" mid-script) - a detached helper deletes it a moment
  REM after this process has already exited instead.
  start /min "" cmd /c "ping 127.0.0.1 -n 2 >nul & del /F /Q "%~f0""
  exit /b
)

start "" powershell.exe -NoProfile -WindowStyle Hidden -STA -ExecutionPolicy Bypass -File "%~dp0%Ps1Name%"
echo Starting HydraTec Watcher - look for the flame icon near your clock.
timeout /t 3 >nul
`;
}
