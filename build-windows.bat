@echo off
REM ========================================================================
REM  ShortsDirector - build the Windows installer (.exe) on your PC.
REM  Double-click this file, or run it from a terminal in the project folder.
REM  Requires Node.js 18+ (https://nodejs.org). Nothing else to install.
REM ========================================================================
setlocal

echo.
echo === ShortsDirector: building the Windows installer ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install it from https://nodejs.org  then run this file again.
  echo.
  pause
  exit /b 1
)

echo Installing dependencies (first run can take a few minutes)...
call npm ci
if errorlevel 1 (
  echo [ERROR] npm ci failed. Try running:  npm install
  pause
  exit /b 1
)

echo.
echo Building the installer...
call npm run dist:win
if errorlevel 1 (
  echo [ERROR] Build failed. See the messages above.
  pause
  exit /b 1
)

echo.
echo === Done! Your installer is in the "dist-desktop" folder. ===
echo Look for a file named  ShortsDirector-Setup-<version>.exe
echo.

REM Open the output folder in Explorer.
if exist "dist-desktop" start "" "dist-desktop"

pause
endlocal
