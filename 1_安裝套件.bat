@echo off
cd /d "%~dp0"
echo ============================================
echo  Installing dependencies (1-3 minutes)...
echo ============================================
echo.
call npm install
echo.
echo ============================================
echo  Done! Press any key to close this window.
echo ============================================
pause
