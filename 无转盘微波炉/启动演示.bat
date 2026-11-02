@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 不转盘的微波炉

rem ---- 检查 main 分支有没有更新 ----
where git >nul 2>nul
if errorlevel 1 (
  echo [提示] 没装 git，跳过更新检查。
  goto open
)
git rev-parse --is-inside-work-tree >nul 2>nul
if errorlevel 1 (
  echo [提示] 这个文件夹不是 git 仓库，跳过更新检查。
  goto open
)

echo 正在检查 main 分支...
git fetch origin main --quiet
if errorlevel 1 (
  echo [提示] 连不上远端，先用本地版本。
  goto open
)

set "BRANCH="
for /f "delims=" %%a in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%a"
if /i not "%BRANCH%"=="main" (
  echo [提示] 当前在 %BRANCH% 分支，不自动更新。
  goto open
)

set "LOCAL="
set "REMOTE="
for /f "delims=" %%a in ('git rev-parse HEAD') do set "LOCAL=%%a"
for /f "delims=" %%a in ('git rev-parse origin/main') do set "REMOTE=%%a"
if "%LOCAL%"=="%REMOTE%" (
  echo 已经是最新版本。
  goto open
)

echo 发现更新，正在拉取...
git pull --ff-only origin main
if errorlevel 1 (
  echo [提示] 拉取失败，可能本地有改动。先用本地版本打开，改动不会被覆盖。
  pause
)

:open
echo 正在打开演示...
start "" "%~dp0index.html"
endlocal
