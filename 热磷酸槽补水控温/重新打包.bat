@echo off
rem Rebuild index.html from src\ (needs Node.js, no packages to install), run the self-check, then open the page.
rem Checks main for updates first.
setlocal
cd /d "%~dp0"
title Hot phosphoric bath rebuild

where git >nul 2>nul
if not errorlevel 1 (
  git rev-parse --is-inside-work-tree >nul 2>nul
  if not errorlevel 1 (
    echo Checking main for updates...
    git pull --ff-only origin main
    if errorlevel 1 echo [WARN] Pull failed or offline, building the local copy.
  )
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install it from https://nodejs.org and run again.
  pause
  exit /b 1
)

echo Self-check: model scenarios...
node tests\test_sim.js
if errorlevel 1 (
  echo [ERROR] Self-check failed, index.html not rebuilt.
  pause
  exit /b 1
)

echo Building index.html ...
node build.mjs
if errorlevel 1 (
  echo [ERROR] Build failed.
  pause
  exit /b 1
)
echo Done.
start "" "%~dp0index.html"
endlocal
