@echo off
chcp 65001 > nul
cd /d "%~dp0"
git add -A
git commit -m "Sparkline: click any point to see date+price tooltip"
git push origin main
echo DONE
pause
