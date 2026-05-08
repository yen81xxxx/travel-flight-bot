@echo off
cd /d "%~dp0"
echo ============================================
echo  Pushing to GitHub...
echo  First time will open browser for auth.
echo ============================================
echo.
git remote remove origin 2>nul
git remote add origin https://github.com/yen81xxxx/travel-flight-bot.git
git branch -M main
git push -u origin main
echo.
echo ============================================
echo  Push complete (or check errors above)
echo  Repo: https://github.com/yen81xxxx/travel-flight-bot
echo ============================================
pause
