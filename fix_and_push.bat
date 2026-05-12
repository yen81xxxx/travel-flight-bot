@echo off
chcp 65001 > nul
cd /d "%~dp0"
del /q /f t1.txt t2.txt t3.txt t6.txt t7.txt t7page.html zz_test_settings.bat 2>nul
git add -A
git commit -m "Route settings via subscriptions to reuse OAuth whitelist"
git push origin main
echo DONE
pause
