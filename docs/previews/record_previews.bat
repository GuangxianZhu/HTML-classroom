@echo off
rem Re-record the README preview GIFs (docs/previews/*.gif).
rem Needs: git, Node.js, ffmpeg in PATH. Playwright is installed on first run.
rem Usage: double-click to re-record all, or: record_previews.bat pump flash
setlocal
cd /d "%~dp0..\.."

echo [1/3] Checking for updates (git pull)...
git pull --ff-only origin main
if errorlevel 1 echo     git pull failed - continuing with local files.

where node >nul 2>nul || (echo Node.js not found. Install from https://nodejs.org/ & pause & exit /b 1)
where ffmpeg >nul 2>nul || (echo ffmpeg not found. Install it, e.g. winget install Gyan.FFmpeg & pause & exit /b 1)

echo [2/3] Checking Playwright...
if not exist "docs\previews\tools\node_modules\playwright" (
  pushd docs\previews\tools
  call npm install --no-save --no-audit --no-fund playwright
  call npx playwright install chromium
  popd
)

echo [3/3] Recording...
node docs\previews\tools\record.js %*
echo Done. GIFs are in docs\previews\
pause
