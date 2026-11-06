@echo off
rem Rebuild the Blender model with the local Blender.
rem Output goes to blender\out: regulators.blend, regulators.glb, spec.json
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

"%BL%" -b --factory-startup -P "blender\build_regulators.py" -- --out "blender\out" %1
if errorlevel 1 (
  echo [ERROR] Build failed. See messages above.
  pause
  exit /b 1
)
echo.
echo Done. Open blender\out\regulators.blend in Blender. Shape key "open" on each diaphragm shows the valve opening.
echo If you changed the geometry, rebuild the web page too: cd web, npm install, node build.mjs
pause
endlocal
