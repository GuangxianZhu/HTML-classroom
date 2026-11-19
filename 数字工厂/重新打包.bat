@echo off
rem Rebuild index.html from src\ (needs Node.js 18+). Checks main for updates first.
setlocal
cd /d "%~dp0"
title DF-01 rebuild

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

if not exist node_modules\three (
  echo Installing build tools ^(three r160 + esbuild^)...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
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
