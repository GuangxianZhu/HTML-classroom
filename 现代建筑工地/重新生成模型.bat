@echo off
rem Rebuild all Blender models of the construction site.
rem Output goes to blender\out: tower.glb, zaoloji.glb, site.blend, spec.json
rem Pass --render as the first argument to also render the preview images (takes a few minutes).
setlocal
cd /d "%~dp0"
title Rebuild construction site models

where git >nul 2>nul
if not errorlevel 1 (
  git rev-parse --is-inside-work-tree >nul 2>nul
  if not errorlevel 1 (
    echo Checking main for updates...
    git pull --ff-only origin main
    if errorlevel 1 echo [WARN] Update failed. Using the local copy.
  )
)

call :findblender
if not defined BL (
  echo [ERROR] Blender not found.
  echo Put the full path of blender.exe into blender_path.txt next to this bat.
  pause
  exit /b 1
)
echo Using Blender: %BL%

"%BL%" -b --factory-startup -P "blender\build_site.py" -- --out "blender\out" %1
if errorlevel 1 (
  echo [ERROR] Build failed. See messages above.
  pause
  exit /b 1
)
echo.
echo Done. Open blender\out\site.blend in Blender (or use the open-model bat) to look at it.
pause
endlocal
exit /b 0

:findblender
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
exit /b 0
