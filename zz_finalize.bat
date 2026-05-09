@echo off
cd /d "%~dp0"
echo === wait for Vercel deploy (90s) ===
timeout /t 90 /nobreak >nul

echo === health check ===
curl -s "https://travel-flight-bot.vercel.app/api/health" > deploy_check.txt
type deploy_check.txt
echo.

echo.
echo === remove leftover zz scripts from repo ===
git rm --cached --ignore-unmatch zz_unlock_push.bat zz_finalize.bat
del /q /f zz_unlock_push.bat 2>nul
del /q /f deploy_check.txt 2>nul
git add -A
git commit -m "Cleanup: remove debug scripts"
git push origin main
echo.
echo Done. Self-deleting...
timeout /t 2 /nobreak >nul
del /q /f "%~f0"
