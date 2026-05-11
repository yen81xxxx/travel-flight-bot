@echo off
chcp 65001 > nul
cd /d "%~dp0"

git add -A
git status --short

git commit -m "Remove Vercel cron config (replaced by GitHub Actions)"
git push origin main

echo.
echo DONE
pause
