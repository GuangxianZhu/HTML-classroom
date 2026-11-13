@echo off
rem Rebuild the Blender model with the local Blender, then rebuild index.html.
rem Output goes to blender\out: variator.blend, variator.glb, spec.json
rem Pass --render as the first argument to also render the preview images.
setlocal
cd /d "%~dp0"
title Rebuild Blender model

where git >nul 2>nul
if not errorlevel 1 (
  git rev-parse --is-inside-work-tree >nul 2>nul
  if not errorlevel 1 (
    echo Checking main for updates...
    git pull --ff-only origin main
    if errorlevel 1 echo [WARN] Update failed. Using the local copy.
  )
)

set "BL="
if exist "%~dp0blender_path.txt" set /p BL=<"%~dp0blender_path.txt"
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

"%BL%" -b --factory-startup -P "blender\build_variator.py" -- --out "blender\out" %1
if errorlevel 1 (
  echo [ERROR] Blender build failed. See messages above.
  pause
  exit /b 1
)
echo.
echo Model done: blender\out\variator.blend
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [INFO] Node.js not found. The model is rebuilt, but index.html still embeds the old model.
  echo Install Node.js, then run this bat again to rebuild the page.
  pause
  exit /b 0
)
pushd web
if not exist node_modules (
  echo Installing page build tools ^(first time only^)...
  call npm install
)
call node test_core.mjs
if errorlevel 1 (
  echo [WARN] Physics checks failed. See messages above.
)
call node build.mjs
popd
echo.
echo Done. index.html is rebuilt. Open it in a browser, or use the other bat in this folder.
pause
endlocal
