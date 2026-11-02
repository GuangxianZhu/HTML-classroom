@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Flash demo

rem ---- check main branch for updates ----
where git >nul 2>nul
if errorlevel 1 (
  echo [info] git not installed, skip update check.
  goto open
)
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo [info] not a git repo, skip update check.
  goto open
)

echo checking main branch...
git fetch origin main --quiet
if errorlevel 1 (
  echo [info] cannot reach remote, using local copy.
  goto open
)

set "BRANCH="
for /f "delims=" %%a in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%a"
if /i not "%BRANCH%"=="main" (
  echo [info] current branch is %BRANCH%, no auto update.
  goto open
)

set "LOCAL="
set "REMOTE="
for /f "delims=" %%a in ('git rev-parse HEAD') do set "LOCAL=%%a"
for /f "delims=" %%a in ('git rev-parse origin/main') do set "REMOTE=%%a"
if "%LOCAL%"=="%REMOTE%" (
  echo already up to date.
  goto open
)

echo update found, pulling...
git pull --ff-only origin main
if errorlevel 1 (
  echo [info] pull failed, maybe local changes. Opening local copy, nothing overwritten.
  pause
)

:open
echo opening demo...
start "" "%~dp0index.html"
endlocal
