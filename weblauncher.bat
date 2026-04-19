REM ═══════════════════════════════════════════════════════════════
REM   The Forgotten Realm — Web Launcher
REM   Opens the hosted online version at the-forgotten-realm.onrender.com
REM
REM   For local play instead, use: launch.bat
REM ═══════════════════════════════════════════════════════════════
@echo off
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0weblauncher.ps1"
pause
