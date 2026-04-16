@echo off
title The Forgotten Realm
color 0A

echo.
echo  =====================================================
echo     THE FORGOTTEN REALM  ^|  Launcher
echo  =====================================================
echo.

cd /d "%~dp0"

:: ── Check Python is available ───────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Python is not installed or not on PATH.
    echo  Download it from https://python.org
    pause
    exit /b 1
)

:: ── Check Git is available ──────────────────────────────
git --version >nul 2>&1
if errorlevel 1 (
    echo  [WARN] Git not found — skipping update check.
    goto :setup_venv
)

:: ── Pull latest from GitHub ─────────────────────────────
echo  [1/4] Checking for updates...
git pull
echo.

:setup_venv
:: ── Create venv if it doesn't exist ────────────────────
if not exist venv\Scripts\activate.bat (
    echo  [2/4] Creating virtual environment for the first time...
    python -m venv venv
    echo.
) else (
    echo  [2/4] Virtual environment found.
)

:: ── Activate venv ───────────────────────────────────────
call venv\Scripts\activate.bat

:: ── Install / update dependencies ───────────────────────
echo  [3/4] Installing dependencies...
pip install -r requirements.txt -q --disable-pip-version-check
echo.

:: ── Open browser after a short delay ───────────────────
echo  [4/4] Starting server...
echo.
echo  -------------------------------------------------------
echo   Game URL:   http://127.0.0.1:5000
echo   Press Ctrl+C in this window to stop the server.
echo  -------------------------------------------------------
echo.

:: Open browser 2.5 seconds after the server starts
start /b "" cmd /c "timeout /t 3 /nobreak > nul && start http://127.0.0.1:5000"

:: Run server (blocks until Ctrl+C)
python app.py

echo.
echo  Server stopped. Press any key to close.
pause > nul
