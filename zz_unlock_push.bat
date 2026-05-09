@echo off
cd /d "%~dp0"
echo === Removing stuck lock file ===
del /q /f .git\index.lock 2>nul
if exist .git\index.lock (
    echo WARN: lock still exists, trying force...
    attrib -r -h -s .git\index.lock >nul 2>&1
    del /q /f .git\index.lock 2>nul
)
echo.
echo === git status ===
git status --short
echo.
echo === stage + commit + push ===
git add -A
git commit -m "Two sections (personal + groups) with group name labels, single-row buttons"
git push origin main
echo.
echo Done.
pause
