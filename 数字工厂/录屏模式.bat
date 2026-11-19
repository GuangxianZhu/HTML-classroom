@echo off
rem Clean recording mode: auto tour + hidden HUD + 2.39:1 letterbox, loops forever.
rem   1) check main for updates   2) open film.html (redirects to index.html?film=1)
rem Start your screen recorder, then press F11 in the browser for full screen.
setlocal
cd /d "%~dp0"
title DF-01 Digital Factory - film mode

where git >nul 2>nul
if errorlevel 1 (
  echo [INFO] git not found, skip update check.
  goto open
)
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo [INFO] Not a git clone, skip update check.
  goto open
)

echo Checking main for updates...
git fetch origin main --quiet
if errorlevel 1 (
  echo [INFO] Remote not reachable. Using the local copy.
  goto open
)

set "BRANCH="
for /f "delims=" %%a in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%a"
if /i not "%BRANCH%"=="main" (
  echo [INFO] On branch %BRANCH%, not updating automatically.
  goto open
)

set "LOCAL="
set "REMOTE="
for /f "delims=" %%a in ('git rev-parse HEAD') do set "LOCAL=%%a"
for /f "delims=" %%a in ('git rev-parse origin/main') do set "REMOTE=%%a"
if "%LOCAL%"=="%REMOTE%" (
  echo Already up to date.
  goto open
)

echo Update found, pulling...
git pull --ff-only origin main
if errorlevel 1 (
  echo [WARN] Pull failed, probably local changes. Opening the local copy, nothing was overwritten.
  pause
)

:open
echo Opening film mode...
start "" "%~dp0film.html"
endlocal
