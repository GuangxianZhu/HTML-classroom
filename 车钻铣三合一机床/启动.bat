@echo off
rem One-click launcher: lathe-mill combo (electronic lead screw) demo
rem   1) git pull main   2) open index.html
setlocal
cd /d "%~dp0"

where git >nul 2>nul
if errorlevel 1 (
    echo [INFO] git not found, skip update.
    goto open
)
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
    echo [INFO] Not a git clone, skip update.
    goto open
)
echo Checking for updates on main...
git pull --ff-only origin main
if errorlevel 1 echo [WARN] Update failed ^(offline or local changes^). Using current version.

:open
if not exist "index.html" (
    echo [ERROR] index.html not found.
    pause
    exit /b 1
)
echo Opening the demo...
start "" "index.html"
endlocal
