@echo off
cd /d "%~dp0"
echo ============================================
echo  Starting local dev server...
echo  Open http://localhost:3000 in your browser
echo  Press Ctrl+C in this window to stop
echo ============================================
echo.
call npm run dev
pause
