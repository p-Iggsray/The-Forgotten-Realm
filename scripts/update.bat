REM ═══════════════════════════════════════════════════════════════
REM   The Forgotten Realm — Update Manager
REM   Pulls the latest version from GitHub with full visual feedback.
REM
REM   Normal update:   update.bat
REM   Rollback:        update.bat --rollback
REM ═══════════════════════════════════════════════════════════════
@echo off
powershell -ExecutionPolicy Bypass -NoProfile -File "%~dp0update.ps1" %*
pause
