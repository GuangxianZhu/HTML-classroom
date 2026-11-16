@echo off
rem One-click: check main for updates, then open blender\out\site.blend in Blender.
rem The .blend shows the site at "core tube poured to floor 30". Every object has custom
rem properties stage / floor (tower) or kind / part (platform), see README.md.
setlocal
cd /d "%~dp0"
title Open construction site model

where git >nul 2>nul
if errorlevel 1 goto open
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 goto open
echo Checking main for updates...
git fetch origin main --quiet
if errorlevel 1 (
  echo [INFO] Remote not reachable. Using the local copy.
  goto open
)
set "BRANCH="
for /f "delims=" %%a in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%a"
if /i not "%BRANCH%"=="main" (
  echo [INFO] On branch %BRANCH%, not updating automatically.
  goto open
)
set "LOCAL="
set "REMOTE="
for /f "delims=" %%a in ('git rev-parse HEAD') do set "LOCAL=%%a"
for /f "delims=" %%a in ('git rev-parse origin/main') do set "REMOTE=%%a"
if "%LOCAL%"=="%REMOTE%" (
  echo Already up to date.
  goto open
)
echo Update found, pulling...
git pull --ff-only origin main
if errorlevel 1 (
  echo [WARN] Pull failed, probably local changes. Opening the local copy, nothing was overwritten.
  pause
)

:open
if not exist "blender\out\site.blend" (
  echo [ERROR] blender\out\site.blend not found. Run the rebuild bat first.
  pause
  exit /b 1
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
if defined BL (
  echo Opening with %BL%
  start "" "%BL%" "%~dp0blender\out\site.blend"
) else (
  echo Blender path not found, opening with the file association instead.
  start "" "%~dp0blender\out\site.blend"
)
endlocal
