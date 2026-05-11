@echo off
chcp 65001 > nul
cd /d "%~dp0"

git add -A
git status --short

git commit -m "Fix: persist ctx via sessionStorage to survive LIFF OAuth redirect"
git push origin main

echo.
echo DONE
pause
