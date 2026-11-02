@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 重新生成 Blender 模型

rem 用本机 Blender 重新跑建模脚本，输出 .blend、.glb 和三张预览图到 blender\out
set "BL="
where blender >nul 2>nul
if not errorlevel 1 set "BL=blender"
if defined BL goto run
for /d %%d in ("%ProgramFiles%\Blender Foundation\Blender *") do (
  if exist "%%d\blender.exe" set "BL=%%d\blender.exe"
)
if not defined BL (
  echo 没找到 Blender。请先安装，或把 blender.exe 所在目录加进 PATH。
  pause
  exit /b 1
)

:run
"%BL%" -b -P "blender\build_microwave.py" -- --out "blender\out"
if errorlevel 1 (
  echo 建模失败，请看上面的错误信息。
  pause
  exit /b 1
)
echo 完成，.blend 在 blender\out 里，可以直接用 Blender 打开。
pause
endlocal
