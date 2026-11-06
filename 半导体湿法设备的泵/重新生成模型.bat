@echo off
rem Rebuild the Blender model, then rebuild index.html
rem   1) git pull main   2) find Blender   3) run the script   4) bundle the page if Node is installed
chcp 65001 >nul
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

rem ---- find Blender: blender_path.txt > PATH > Program Files > Steam ----
set "BL="
if exist "blender_path.txt" set /p BL=<"blender_path.txt"
if defined BL if not exist "%BL%" set "BL="
if not defined BL (
    where blender >nul 2>nul && for /f "delims=" %%B in ('where blender') do if not defined BL set "BL=%%B"
)
if not defined BL (
    for /d %%D in ("%ProgramFiles%\Blender Foundation\Blender*") do if exist "%%D\blender.exe" set "BL=%%D\blender.exe"
)
if not defined BL (
    if exist "%ProgramFiles(x86)%\Steam\steamapps\common\Blender\blender.exe" set "BL=%ProgramFiles(x86)%\Steam\steamapps\common\Blender\blender.exe"
)
if not defined BL (
    echo [ERROR] Blender not found.
    echo Put the full path of blender.exe into blender_path.txt next to this bat.
    pause
    exit /b 1
)
echo Using Blender: %BL%

set "RENDER="
choice /c YN /n /t 10 /d N /m "Render preview images with Cycles too? (slower)  [Y/N, default N in 10 s] "
if errorlevel 2 (set "RENDER=") else (set "RENDER=--render")

"%BL%" -b --factory-startup -P "blender\build_pumps.py" -- --out "blender\out" %RENDER%
if errorlevel 1 (
    echo [ERROR] Build failed. See messages above.
    pause
    exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
    echo [INFO] Node.js not found, index.html was not rebuilt. The new model is in blender\out.
    pause
    exit /b 0
)
pushd web
call npm install --silent
node build.mjs
popd
echo Done. Open index.html to see the result.
pause
endlocal
