@echo off
chcp 65001 > nul
cd /d "%~dp0"
git add -A
git commit -m "Production-grade hardening: leave-event cleanup, expired-sub archive, push retry, double-submit guard"
git push origin main
echo DONE
pause
