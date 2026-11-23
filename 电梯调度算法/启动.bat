@echo off
rem One-click launcher: elevator scheduling demo (single offline page index.html).
rem Checks the main branch for updates first (git pull), then opens the page in the default browser.
setlocal
cd /d "%~dp0"
title Elevator scheduling demo

where git >nul 2>nul
if errorlevel 1 (
  echo [info] git not installed, skip update check.
  goto open
)
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo [info] not a git clone, skip update check.
  goto open
)
echo Checking main for updates...
git pull --ff-only origin main
if errorlevel 1 (
  echo [WARN] Update failed ^(offline or local changes^). Opening the local copy, nothing overwritten.
  timeout /t 3 >nul
)

:open
if not exist "index.html" (
  echo [ERROR] index.html not found next to this bat.
  pause
  exit /b 1
)
start "" "%~dp0index.html"
endlocal
