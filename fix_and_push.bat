@echo off
chcp 65001 > nul
cd /d "%~dp0"

git add -A
git status --short

git commit -m "Sparkline: add 7/30/365 day selector and price labels (min/max/current)"
git push origin main

echo.
echo DONE
pause
