@echo off
rem Rebuild index.html from web/src (no Blender needed)
rem   1) git pull main   2) npm install   3) self-test   4) bundle   5) open index.html
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem ---- update from GitHub main (skipped if git missing / offline) ----
where git >nul 2>nul
if not errorlevel 1 (
    git rev-parse --is-inside-work-tree >nul 2>nul
    if not errorlevel 1 (
        echo Checking for updates on main...
        git pull --ff-only origin main
        if errorlevel 1 echo [WARN] Update failed ^(offline or local changes^). Using current version.
    )
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install it from https://nodejs.org and run this again.
    pause
    exit /b 1
)

pushd web
echo Installing build tools...
call npm install --silent
if errorlevel 1 (
    echo [ERROR] npm install failed.
    popd
    pause
    exit /b 1
)
echo Running self-test...
node test_sim.mjs
if errorlevel 1 echo [WARN] Self-test reported failures. See messages above.
echo Bundling the page...
node build.mjs
if errorlevel 1 (
    echo [ERROR] Build failed. index.html was not updated. See messages above.
    popd
    pause
    exit /b 1
)
popd

echo Done. Opening index.html...
start "" "index.html"
pause
endlocal
