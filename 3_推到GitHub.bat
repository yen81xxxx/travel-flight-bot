@echo off
cd /d "%~dp0"
echo ============================================
echo  Cleaning up any existing .git folder...
echo ============================================
attrib -h .git >nul 2>&1
rmdir /s /q .git >nul 2>&1
echo.
echo ============================================
echo  Initializing git repository...
echo ============================================
git init -b main
git config user.email "youngmen8881231@gmail.com"
git config user.name "YM prox5"
git add .
git commit -m "Initial commit: Travel Flight Bot replacement for N8N"
echo.
echo ============================================
echo  Local commit done!
echo  Next: open GitHub Desktop to publish this repo
echo  (File menu - Add local repository - select this folder)
echo ============================================
pause
