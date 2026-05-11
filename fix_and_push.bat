@echo off
chcp 65001 > nul
cd /d "%~dp0"

git add -A
git status --short

git commit -m "Stats accuracy fix + GitHub Actions cron fallback for Vercel"
git push origin main

echo.
echo DONE
pause
