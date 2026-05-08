@echo off
cd /d "%~dp0"
echo ============================================
echo  Pushing latest changes to GitHub...
echo  Vercel will auto-redeploy after push.
echo ============================================
echo.
git add .
git commit -m "Trigger redeploy with LIFF_ID env var"
git push origin main
echo.
echo ============================================
echo  Done. Check Vercel dashboard for deploy status.
echo  https://vercel.com/yens-projects-90c5baf9/travel-flight-bot
echo ============================================
pause
