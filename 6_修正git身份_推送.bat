@echo off
cd /d "%~dp0"
echo ============================================
echo  Fixing git committer identity to match GitHub
echo  and pushing to trigger redeploy
echo ============================================
echo.
git config user.name "yen81xxxx"
git config user.email "yen81xxxx@users.noreply.github.com"
echo.
echo Amending last commit with correct identity...
git commit --amend --reset-author --no-edit
echo.
echo Force-pushing...
git push origin main --force
echo.
echo ============================================
echo  Done. Vercel should rebuild now.
echo ============================================
pause
