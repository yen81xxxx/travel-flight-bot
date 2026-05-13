@echo off
chcp 65001 > nul
cd /d "%~dp0"
git add -A
git commit -m "Fix settings 400; price doubling bug; daily push uses nearest sub dates"
git push origin main
echo DONE
pause
