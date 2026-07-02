@echo off
setlocal
set "NODE_DIR=%LOCALAPPDATA%\nodejs-x64"
if not exist "%NODE_DIR%\node.exe" (
  echo Error: x64 Node not found at %NODE_DIR%
  echo Install it or run: winget install OpenJS.NodeJS.LTS
  exit /b 1
)
set "PATH=%NODE_DIR%;%PATH%"
cd /d "%~dp0.."
if exist ".next" (
  rd /s /q ".next" >nul 2>&1
  powershell -NoProfile -ExecutionPolicy Bypass -Command "if (Test-Path '.next') { Remove-Item -LiteralPath '.next' -Recurse -Force -ErrorAction SilentlyContinue }" >nul 2>&1
)
"%NODE_DIR%\node.exe" "node_modules\next\dist\bin\next" dev -H 0.0.0.0 -p 3000 %*
