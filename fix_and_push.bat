@echo off
chcp 65001 > nul
cd /d "%~dp0"
git add -A
git commit -m "Settings: skip LIFF auth when ctx present (instant group settings)"
git push origin main
echo DONE
pause
