@echo off
setlocal
cd /d "%~dp0"
where npm >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer, then run this file again.
  pause
  exit /b 1
)
if exist "web\node_modules\vite" goto ready
call npm ci
if errorlevel 1 (
  echo Installation failed. Check your internet connection and Node.js version.
  pause
  exit /b 1
)
:ready
echo Reframe Studio will open at http://127.0.0.1:5173
call npm run dev -- --open
if errorlevel 1 pause
