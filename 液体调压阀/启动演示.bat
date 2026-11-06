@echo off
rem One-click launcher: liquid pressure regulator demo
rem   1) check main for updates   2) open index.html in the default browser
setlocal
cd /d "%~dp0"
title Liquid pressure regulator demo

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
echo Opening the demo...
start "" "%~dp0index.html"
endlocal
