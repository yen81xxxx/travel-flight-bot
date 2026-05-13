@echo off
chcp 65001 > nul
cd /d "%~dp0"
git add -A
git commit -m "Daily push uses each source's nearest subscription dates (not generic defaults)"
git push origin main
echo DONE
pause
