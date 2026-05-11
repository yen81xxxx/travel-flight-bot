@echo off
chcp 65001 > nul
cd /d "%~dp0"
git add -A
git commit -m "Sparkline: better label placement (no overlap when prices are flat or near threshold)"
git push origin main
echo DONE
pause
