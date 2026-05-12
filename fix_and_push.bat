@echo off
chcp 65001 > nul
cd /d "%~dp0"
git add -A
git commit -m "Unified TabNav across search/subscriptions/settings pages"
git push origin main
echo DONE
pause
