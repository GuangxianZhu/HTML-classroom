@echo off
rem Rebuild the 9 Blender models (GLB + preview PNG) and the single-file index.html.
rem Uses the local Blender. Pass --no-render to skip the preview images (much faster).
rem Pass model names to rebuild only some, e.g.:  rebuild.bat absorb ozone
setlocal
cd /d "%~dp0"
title Rebuild concentration meter models

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

"%BL%" -b --factory-startup -P "blender\build_models.py" -- %*
if errorlevel 1 (
  echo [ERROR] Model build failed. See messages above.
  pause
  exit /b 1
)

set "PY="
where python >nul 2>nul && set "PY=python"
if not defined PY (where py >nul 2>nul && set "PY=py -3")
if not defined PY (
  echo [WARN] Python not found, index.html was NOT rebuilt. Run build_offline.py later.
  pause
  exit /b 0
)
%PY% build_offline.py
echo.
echo Done. Open index.html to check.
pause
endlocal
