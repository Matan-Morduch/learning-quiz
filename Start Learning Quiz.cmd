@echo off
rem Learning Quiz for Windows: double-click to start. Keep this window open while you use the app.
title Learning Quiz
cd /d "%~dp0"
if "%PORT%"=="" set "PORT=4747"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed yet.
  echo  Install the LTS version from https://nodejs.org , then double-click this file again.
  echo.
  pause
  exit /b 1
)

rem Already running? Just open it.
curl -s -o nul http://127.0.0.1:%PORT%/api/health >nul 2>nul
if not errorlevel 1 (
  start "" http://localhost:%PORT%/
  exit /b 0
)

rem Your questions and notes live next to the app, in the Learning folder.
if "%QUIZ_LEARNING_DIR%"=="" set "QUIZ_LEARNING_DIR=%~dp0Learning"
if not exist "%QUIZ_LEARNING_DIR%" mkdir "%QUIZ_LEARNING_DIR%"
set "QUIZ_OPEN_BROWSER=1"

echo.
echo  Learning Quiz is running at http://localhost:%PORT%/
echo  Keep this window open while you use it. Close it to stop the app.
echo  Your questions and notes: %QUIZ_LEARNING_DIR%
echo.
node server.js
echo.
echo  The app stopped.
pause
