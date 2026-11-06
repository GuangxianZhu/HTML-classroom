@echo off
rem Open the multi-file source version (site\) through a tiny local web server.
rem Browsers block loading 3D models from file://, so this starts
rem "python -m http.server" and opens http://localhost:8765/
rem Close this window to stop the server.
setlocal
cd /d "%~dp0"
title Concentration meter demo - source version (close to stop)

where git >nul 2>nul
if not errorlevel 1 (
  git rev-parse --is-inside-work-tree >nul 2>nul
  if not errorlevel 1 (
    echo Checking main for updates...
    git pull --ff-only origin main
    if errorlevel 1 echo [WARN] Update failed. Using the local copy.
  )
)

set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY (where py >nul 2>nul && set "PY=py -3")
if not defined PY (
  echo [ERROR] Python not found. Open index.html instead, it works without a server.
  pause
  exit /b 1
)

set PORT=8765
echo Serving site\ at http://localhost:%PORT%/
start "" "http://localhost:%PORT%/"
%PY% -m http.server %PORT% --bind 127.0.0.1 --directory "%~dp0site"
endlocal
