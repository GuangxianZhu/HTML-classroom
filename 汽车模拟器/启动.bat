@echo off
rem One-click launcher: car simulator (drivable web page + Blender model of body and two powertrains: petrol + CVT, two-motor hybrid)
rem   1) git pull main   2) menu: open the simulator page / open preview images / rebuild the model with Blender
chcp 65001 >nul
setlocal
cd /d "%~dp0"

rem ---- update from GitHub main (skipped if git missing / offline) ----
where git >nul 2>nul
if errorlevel 1 (
    echo [INFO] git not found, skip update.
    goto menu
)
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
    echo [INFO] Not a git clone, skip update.
    goto menu
)
echo Checking for updates on main...
git pull --ff-only origin main
if errorlevel 1 echo [WARN] Update failed ^(offline or local changes^). Using current version.

:menu
echo.
echo   [1] Open the simulator page (index.html, works offline)
echo   [2] Open the preview images (renders + front bay layout)
echo   [3] Rebuild the model with Blender, re-pack index.html, then open car.blend
echo   [4] Exit
choice /c 1234 /n /m "Choose 1 / 2 / 3 / 4: "
if errorlevel 4 exit /b 0
if errorlevel 3 goto build
if errorlevel 2 goto images

if not exist "index.html" (
    echo [ERROR] index.html not found next to this bat.
    pause
    exit /b 1
)
start "" "index.html"
exit /b 0

:images
if not exist "blender\out\view_exterior.jpg" (
    echo [ERROR] blender\out\view_exterior.jpg not found.
    pause
    exit /b 1
)
start "" "blender\out\view_exterior.jpg"
start "" "blender\out\view_exterior_rear.jpg"
start "" "blender\out\view_side.jpg"
start "" "blender\out\view_bay.jpg"
start "" "blender\out\view_internals.jpg"
start "" "blender\out\layout_frontbay.png"
exit /b 0

:build
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

"%BL%" -b --factory-startup -P "blender\build_car.py" -- --out "blender\out" %RENDER%
if errorlevel 1 (
    echo [ERROR] Build failed. See messages above.
    pause
    exit /b 1
)
rem ---- second powertrain: two-motor hybrid (writes pt_ehev.glb, car.glb is left alone) ----
"%BL%" -b --factory-startup -P "blender\build_car.py" -- --pt ehev --out "blender\out" %RENDER%
if errorlevel 1 (
    echo [ERROR] Hybrid powertrain build failed. See messages above.
    pause
    exit /b 1
)

rem ---- the page embeds the model, so pack it again (needs Node.js) ----
where node >nul 2>nul
if errorlevel 1 (
    echo [INFO] Node.js not found: index.html still contains the previous model.
    goto openblend
)
pushd web
if not exist "node_modules" call npm install --no-audit --no-fund
call node test_core.mjs
if errorlevel 1 echo [WARN] The self-check reported failures. See messages above.
call node build.mjs
if errorlevel 1 echo [WARN] Packing index.html failed. See messages above.
popd

:openblend
echo Done. Opening car.blend (press Space in Blender to play the exploded view)...
start "" "%BL%" "blender\out\car.blend"
