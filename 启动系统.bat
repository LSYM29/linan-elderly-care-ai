@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"

echo ========================================
echo   Linan Elderly Care - Standard API Edition
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install Node.js 22.13 or later.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Reinstall the full Node.js package.
  pause
  exit /b 1
)

if not exist "package.json" (
  echo [ERROR] package.json is missing. The project files are incomplete.
  pause
  exit /b 1
)

if not exist "scripts\setup-env.js" (
  echo [ERROR] scripts\setup-env.js is missing. The project files are incomplete.
  pause
  exit /b 1
)

set "NEEDS_INIT=0"
call node "scripts\setup-env.js"
set "ENV_SETUP_CODE=%ERRORLEVEL%"
if "%ENV_SETUP_CODE%"=="10" goto env_created
if "%ENV_SETUP_CODE%"=="0" goto env_ready
echo [ERROR] Environment configuration failed.
pause
exit /b %ENV_SETUP_CODE%

:env_created
set "NEEDS_INIT=1"

:env_ready

if not exist "node_modules\express\package.json" (
  echo [SETUP] Installing project dependencies...
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed. Check the network and npm configuration.
    pause
    exit /b 1
  )
)

sc query MySQL80 >nul 2>nul
if not errorlevel 1 (
  sc query MySQL80 | find "RUNNING" >nul
  if errorlevel 1 (
    echo [DATABASE] MySQL80 is stopped. Windows may ask for administrator permission.
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath 'sc.exe' -ArgumentList @('start','MySQL80') -Verb RunAs -Wait -WindowStyle Hidden"
    timeout /t 2 /nobreak >nul
    sc query MySQL80 | find "RUNNING" >nul
    if errorlevel 1 (
      echo [ERROR] MySQL80 could not be started.
      echo [ERROR] Right-click this file, choose Run as administrator, and try again.
      pause
      exit /b 1
    )
  )
)

if /I "%~1"=="init" set "NEEDS_INIT=1"

if "%NEEDS_INIT%"=="1" (
  echo [DATABASE] Initializing or updating the database...
) else (
  echo [DATABASE] Checking the database connection and structure...
)

call npm run init-db
if errorlevel 1 (
  echo [ERROR] Database connection or initialization failed.
  echo [ERROR] Check whether MySQL is running and whether the password in .env is correct.
  echo [ERROR] The web server was not started, so the login page will not show a misleading error.
  pause
  exit /b 1
)

call npm run init-ai
if errorlevel 1 (
  echo [ERROR] AI database initialization failed. Check the error above.
  pause
  exit /b 1
)

echo.
echo [START] Open this address in a browser: http://127.0.0.1:3002
echo [INFO] Keep this window open while using the system.
echo.
call npm start
set "APP_EXIT_CODE=%ERRORLEVEL%"

if not "%APP_EXIT_CODE%"=="0" (
  echo.
  echo [ERROR] The system stopped with exit code %APP_EXIT_CODE%.
  echo Check the error above, the MySQL service, and the configured port in .env.
)

pause
exit /b %APP_EXIT_CODE%

