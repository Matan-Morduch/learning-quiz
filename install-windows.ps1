# Learning Quiz for Windows: installs (or updates) everything. Paste this into PowerShell:
#
#   irm https://raw.githubusercontent.com/Matan-Morduch/learning-quiz/main/install-windows.ps1 | iex
#
# 1. Node.js LTS (winget), if missing
# 2. Gemini CLI (npm install -g @google/gemini-cli), if missing
# 3. The app, into %USERPROFILE%\LearningQuiz (an update keeps your data\ and Learning\ folders)
# 4. A "Learning Quiz" shortcut on the desktop
# 5. Google sign-in for Gemini, if not done yet
# 6. Starts the app in the browser
# Run it again any time to update.

function Install-LearningQuiz {
  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'   # Invoke-WebRequest is very slow with the progress bar
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $Repo = 'Matan-Morduch/learning-quiz'
  $Dest = Join-Path $HOME 'LearningQuiz'

  function Say($m) { Write-Host ''; Write-Host "==> $m" -ForegroundColor Cyan }
  function Fail($m) { Write-Host ''; Write-Host "STOPPED: $m" -ForegroundColor Red; Write-Host 'Copy this message to the AI that is helping you.' -ForegroundColor Yellow; return $false }
  function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($env:APPDATA) { $env:Path += ";$env:APPDATA\npm" }
  }
  function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

  Write-Host 'Learning Quiz setup' -ForegroundColor Green

  # ---- 1. Node.js ----
  Refresh-Path
  $major = 0
  if (Have 'node.exe') { try { $major = [int]((& node.exe -v) -replace '^v(\d+).*', '$1') } catch { $major = 0 } }
  if ($major -lt 20) {
    Say 'Installing Node.js (the engine the app runs on). Windows may ask for permission: click Yes.'
    if (-not (Have 'winget.exe')) { return (Fail 'winget is missing. Install Node.js LTS from https://nodejs.org (click the big LTS button, then Next until Finish), close PowerShell, open it again and run the same command again.') }
    & winget.exe install --id OpenJS.NodeJS.LTS -e --source winget --accept-source-agreements --accept-package-agreements
    Refresh-Path
    if (-not (Have 'node.exe')) { return (Fail 'Node.js was installed but this window cannot see it yet. Close PowerShell, open it again and run the same command again.') }
  }
  Write-Host "Node.js $(& node.exe -v) is ready."

  # ---- 2. Gemini CLI ----
  if (-not (Have 'gemini.cmd')) {
    Say 'Installing the Gemini command line tool (takes a minute or two)...'
    & npm.cmd install -g @google/gemini-cli
    if ($LASTEXITCODE -ne 0) { return (Fail 'Installing the Gemini CLI failed (see the npm messages above).') }
    Refresh-Path
    if (-not (Have 'gemini.cmd')) { return (Fail 'The Gemini CLI was installed but this window cannot see it yet. Close PowerShell, open it again and run the same command again.') }
  }
  Write-Host 'Gemini CLI is ready.'

  # ---- 3. The app ----
  Say "Downloading Learning Quiz into $Dest ..."
  $tmp = Join-Path $env:TEMP 'learning-quiz-setup'
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'app.zip'
  try { Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/$Repo/archive/refs/heads/main.zip" -OutFile $zip }
  catch { return (Fail "The download failed: $($_.Exception.Message). Check the internet connection and run the command again.") }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  $src = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
  if (-not $src) { return (Fail 'The downloaded file was empty. Run the command again.') }
  New-Item -ItemType Directory -Path $Dest -Force | Out-Null
  # Copies over the old version; data\ (progress) and Learning\ (questions) are not in the download, so they stay.
  & robocopy.exe $src.FullName $Dest /E /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { return (Fail "Copying the app into $Dest failed (robocopy code $LASTEXITCODE). If the app is open, close its window and run the command again.") }
  Remove-Item -Recurse -Force $tmp
  Write-Host 'App files are ready.'

  # ---- 4. Desktop shortcut ----
  try {
    $desktop = [Environment]::GetFolderPath('Desktop')
    $shell = New-Object -ComObject WScript.Shell
    $lnk = $shell.CreateShortcut((Join-Path $desktop 'Learning Quiz.lnk'))
    $lnk.TargetPath = Join-Path $Dest 'Start Learning Quiz.cmd'
    $lnk.WorkingDirectory = $Dest
    $lnk.Description = 'Start Learning Quiz'
    $lnk.Save()
    Write-Host 'Added "Learning Quiz" to the desktop.'
  } catch { Write-Host "(Could not add a desktop shortcut: you can open $Dest and double-click 'Start Learning Quiz'.)" -ForegroundColor Yellow }

  # ---- 5. Google sign-in for Gemini ----
  $creds = Join-Path $HOME '.gemini\oauth_creds.json'
  if (-not (Test-Path $creds)) {
    Say 'Now sign in to Gemini with your Google account (once).'
    Write-Host '  1. Gemini opens below. If it asks whether to trust the folder, pick "Trust folder".'
    Write-Host '  2. Pick "Sign in with Google" (arrow keys, then Enter). Your browser opens.'
    Write-Host '  3. Choose the Google account that has your Gemini plan and click Allow / Sign in.'
    Write-Host '  4. Back here, when you see a box to type in, type  /quit  and press Enter.'
    Write-Host ''
    Read-Host 'Press Enter to open Gemini' | Out-Null
    $signin = Join-Path $env:TEMP 'learning-quiz-signin'
    New-Item -ItemType Directory -Path $signin -Force | Out-Null
    Push-Location $signin
    try { $env:GEMINI_API_KEY = $null; & gemini.cmd } finally { Pop-Location }
    if (-not (Test-Path $creds)) { return (Fail 'Gemini is not signed in yet. Run the same command again and pick "Sign in with Google".') }
  }
  Write-Host 'Gemini is signed in.'

  # ---- 6. Start ----
  Say 'Starting Learning Quiz. A black window opens: keep it open while you use the app (close it to stop).'
  Start-Process -FilePath (Join-Path $Dest 'Start Learning Quiz.cmd') -WorkingDirectory $Dest
  Write-Host ''
  Write-Host 'Done! The app opens in your browser at http://localhost:4747' -ForegroundColor Green
  Write-Host 'Next time, double-click "Learning Quiz" on the desktop. To update, run the same command again.'
  return $true
}
Install-LearningQuiz | Out-Null
