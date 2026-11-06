# Learning Quiz for Windows: installs (or updates) everything. Paste this into PowerShell:
#
#   irm https://raw.githubusercontent.com/Matan-Morduch/learning-quiz/main/install-windows.ps1 | iex
#
# That sets it up with Gemini (Google sign-in). With Claude Code instead (needs a paid Claude plan):
#
#   $env:LQ_AI='claude'; irm https://raw.githubusercontent.com/Matan-Morduch/learning-quiz/main/install-windows.ps1 | iex
#
# 1. Node.js LTS (winget), if missing
# 2. The AI: Gemini CLI (npm install -g @google/gemini-cli), or Git for Windows + Claude Code (claude.ai/install.ps1)
# 3. The app, into %USERPROFILE%\LearningQuiz (an update keeps your data\ and Learning\ folders)
# 4. A "Learning Quiz" shortcut on the desktop
# 5. Sign-in: Google for Gemini, or the Claude account for Claude Code, if not done yet
# 6. Starts the app in the browser
# Run it again any time to update: it remembers the choice (LearningQuiz\.ai-engine). Settings -> AI in the
# app can switch engines at any time.

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
    $env:Path += ";$HOME\.local\bin"   # Claude Code's installer puts claude.exe here
  }
  function Have($cmd) { [bool](Get-Command $cmd -ErrorAction SilentlyContinue) }

  # Which AI: $env:LQ_AI, else the choice from the last install, else Gemini.
  $choiceFile = Join-Path $Dest '.ai-engine'
  $ai = "$env:LQ_AI".Trim().ToLower()
  if (-not $ai -and (Test-Path $choiceFile)) { $ai = (Get-Content $choiceFile -Raw).Trim() }
  $ai = if ($ai -match 'claude') { 'claude' } else { 'gemini-cli' }
  $aiName = if ($ai -eq 'claude') { 'Claude' } else { 'Gemini' }

  Write-Host "Learning Quiz setup (AI: $aiName)" -ForegroundColor Green

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

  # ---- 2. The AI program ----
  if ($ai -eq 'gemini-cli') {
    if (-not (Have 'gemini.cmd')) {
      Say 'Installing the Gemini command line tool (takes a minute or two)...'
      & npm.cmd install -g @google/gemini-cli
      if ($LASTEXITCODE -ne 0) { return (Fail 'Installing the Gemini CLI failed (see the npm messages above).') }
      Refresh-Path
      if (-not (Have 'gemini.cmd')) { return (Fail 'The Gemini CLI was installed but this window cannot see it yet. Close PowerShell, open it again and run the same command again.') }
    }
    Write-Host 'Gemini CLI is ready.'
  } else {
    # Claude Code on Windows needs Git for Windows (it runs its commands in Git Bash).
    if (-not (Have 'git.exe')) {
      Say 'Installing Git for Windows (Claude Code needs it). Windows may ask for permission: click Yes.'
      if (-not (Have 'winget.exe')) { return (Fail 'winget is missing. Install Git from https://git-scm.com/download/win (Next until Finish), close PowerShell, open it again and run the same command again.') }
      & winget.exe install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements
      Refresh-Path
      if (-not (Have 'git.exe')) { return (Fail 'Git was installed but this window cannot see it yet. Close PowerShell, open it again and run the same command again.') }
    }
    if (-not (Have 'claude.exe')) {
      Say 'Installing Claude Code (takes a minute or two)...'
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command 'irm https://claude.ai/install.ps1 | iex'
      Refresh-Path
      if (-not (Have 'claude.exe')) { return (Fail 'Installing Claude Code failed (see the messages above). Close PowerShell, open it again and run the same command again.') }
    }
    Write-Host 'Claude Code is ready.'
  }

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
  Set-Content -Path $choiceFile -Value $ai -NoNewline   # the start file makes it the app's default engine
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

  # ---- 5. Sign-in ----
  $signin = Join-Path $env:TEMP 'learning-quiz-signin'
  New-Item -ItemType Directory -Path $signin -Force | Out-Null
  if ($ai -eq 'gemini-cli') {
    $creds = Join-Path $HOME '.gemini\oauth_creds.json'
    if (-not (Test-Path $creds)) {
      Say 'Now sign in to Gemini with your Google account (once).'
      Write-Host '  1. Gemini opens below. If it asks whether to trust the folder, pick "Trust folder".'
      Write-Host '  2. Pick "Sign in with Google" (arrow keys, then Enter). Your browser opens.'
      Write-Host '  3. Choose the Google account that has your Gemini plan and click Allow / Sign in.'
      Write-Host '  4. Back here, when you see a box to type in, type  /quit  and press Enter.'
      Write-Host ''
      Read-Host 'Press Enter to open Gemini' | Out-Null
      Push-Location $signin
      try { $env:GEMINI_API_KEY = $null; & gemini.cmd } finally { Pop-Location }
      if (-not (Test-Path $creds)) { return (Fail 'Gemini is not signed in yet. Run the same command again and pick "Sign in with Google".') }
    }
    Write-Host 'Gemini is signed in.'
  } else {
    # Signed in = a one-line question gets an answer.
    # (Errors only 'Continue' here: Windows PowerShell turns a program's stderr into errors when it's captured.)
    function Claude-Works {
      $ErrorActionPreference = 'Continue'
      Push-Location $signin
      try { $env:ANTHROPIC_API_KEY = $null; $r = (& claude.exe -p 'Reply with just the word OK' 2>&1 | Out-String) } catch { $r = '' } finally { Pop-Location }
      return ($r -cmatch '\bOK\b')
    }
    Say 'Checking the Claude sign-in...'
    if (-not (Claude-Works)) {
      Say 'Now sign in to Claude with your Claude account (once).'
      Write-Host '  1. Claude Code opens below. Press Enter to accept the look (text style) it suggests.'
      Write-Host '  2. Pick "Claude account with subscription" (arrow keys, then Enter). Your browser opens.'
      Write-Host '  3. Sign in to claude.ai in the browser and click Authorize.'
      Write-Host '  4. Back here, press Enter through any notes. If it asks whether to trust the folder, pick "Yes".'
      Write-Host '  5. When you see a box to type in, type  /exit  and press Enter.'
      Write-Host ''
      Read-Host 'Press Enter to open Claude Code' | Out-Null
      Push-Location $signin
      try { & claude.exe } finally { Pop-Location }
      if (-not (Claude-Works)) { return (Fail 'Claude does not answer yet: it is not signed in, or the account has no Claude plan (Pro or Max). Run the same command again to sign in.') }
    }
    Write-Host 'Claude is signed in.'
  }

  # ---- 6. Start ----
  Say 'Starting Learning Quiz. A black window opens: keep it open while you use the app (close it to stop).'
  Start-Process -FilePath (Join-Path $Dest 'Start Learning Quiz.cmd') -WorkingDirectory $Dest
  Write-Host ''
  Write-Host 'Done! The app opens in your browser at http://localhost:4747' -ForegroundColor Green
  Write-Host 'Next time, double-click "Learning Quiz" on the desktop. To update, run the same command again.'
  return $true
}
Install-LearningQuiz | Out-Null
