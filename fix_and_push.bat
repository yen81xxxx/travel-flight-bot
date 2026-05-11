@echo off
chcp 65001 > nul
cd /d "%~dp0"

del /q /f all_subs.txt 2>nul
del /q /f recent_notifs.txt 2>nul
del /q /f zz_check_sub.bat 2>nul
del /q /f check_gh.bat 2>nul
del /q /f gh_path.txt 2>nul

git add -A
git status --short

git commit -m "Per-source notification toggles: daily summary + price alerts"
git push origin main

echo.
echo DONE
pause
