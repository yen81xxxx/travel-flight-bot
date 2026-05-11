@echo off
chcp 65001 > nul
cd /d "%~dp0"

del /q /f .git\index 2>nul
del /q /f .git\index.lock 2>nul

git reset

del /q /f zz_check2.bat 2>nul
del /q /f zz_check3.bat 2>nul
del /q /f zz_check_quotes.bat 2>nul
del /q /f zz_test_cron.bat 2>nul
del /q /f zz_debug.bat 2>nul
del /q /f cron_result.json 2>nul
del /q /f q2027.txt 2>nul
del /q /f quotes.txt 2>nul
del /q /f quotes_all.txt 2>nul
del /q /f runs.txt 2>nul
del /q /f runs_all.txt 2>nul
del /q /f subs.txt 2>nul
del /q /f bundle.js 2>nul
del /q /f page.html 2>nul
del /q /f marker_check.txt 2>nul
del /q /f important_check.txt 2>nul
del /q /f deploy_check.txt 2>nul
del /q /f debug_btn.txt 2>nul
del /q /f find_git.bat 2>nul

git add -A
git status --short

git commit -m "Fix alert flex subs button to include ctx for group source"
git push origin main

echo.
echo DONE
pause
