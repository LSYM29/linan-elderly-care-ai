@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -STA -ExecutionPolicy Bypass -File "scripts\configure-key.ps1"
if errorlevel 1 pause
