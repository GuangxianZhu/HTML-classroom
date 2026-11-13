@echo off
rem Rebuild index.html from web/src (no Blender needed)
rem   1) git pull main   2) npm install   3) self-test   4) bundle   5) open index.html
setlocal
cd /d "%~dp0"

where git >nul 2>nul
if not errorlevel 1 (
    git rev-parse --is-inside-work-tree >nul 2>nul
    if not errorlevel 1 (
        echo Checking for updates on main...
        git pull --ff-only origin main
        if errorlevel 1 echo [WARN] Update failed. Using current version.
    )
)
where npm >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install it from https://nodejs.org first.
    pause
    exit /b 1
)
pushd web
call npm install --silent
node test_core.mjs
if errorlevel 1 (
    echo [ERROR] Self-test failed.
    popd
    pause
    exit /b 1
)
node build.mjs
popd
start "" "index.html"
endlocal
