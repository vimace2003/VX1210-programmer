@echo off
rem Start CE42 Next with the portable Node.js in ..\tools (falls back to a Node on PATH).
setlocal
set "NODEDIR=%~dp0..\tools\node-v24.21.0-win-x64"
if exist "%NODEDIR%\node.exe" set "PATH=%NODEDIR%;%PATH%"
cd /d "%~dp0"
if not exist node_modules (
  call npm install --no-fund --no-audit || exit /b 1
)
call npm run dev -w @ce42/web -- --open
