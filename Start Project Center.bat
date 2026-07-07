@echo off
title Project Center - keep this window open
cd /d "%~dp0"
set PORT=4100
echo ============================================
echo   Starting your Project Center...
echo   Keep THIS window open while you use it.
echo   Your app: http://localhost:4100
echo ============================================
echo.
timeout /t 2 /nobreak >nul
start "" http://localhost:4100
node server.js
echo.
echo Server stopped. Press any key to close.
pause >nul
