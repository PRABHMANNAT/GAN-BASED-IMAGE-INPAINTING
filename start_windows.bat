@echo off
setlocal
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" goto install
where py >nul 2>nul
if errorlevel 1 goto usepython
py -3 -m venv .venv
goto checkenv
:usepython
python -m venv .venv
:checkenv
if not exist ".venv\Scripts\python.exe" (
  echo Please install Python 3.11, 3.12 or 3.13 and run this file again.
  pause
  exit /b 1
)
:install
".venv\Scripts\python.exe" -c "import torch" >nul 2>nul
if not errorlevel 1 goto requirements
".venv\Scripts\python.exe" -m pip install torch --index-url https://download.pytorch.org/whl/cpu
if errorlevel 1 (
  echo PyTorch installation failed. Check your internet connection and Python version.
  pause
  exit /b 1
)
:requirements
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 (
  echo Installation failed. Check your internet connection and Python version.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" app.py --open
if errorlevel 1 pause
