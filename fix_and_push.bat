@echo off
chcp 65001 > nul
cd /d "%~dp0"
REM ── clean stale lock files (left over from sandbox-side git operations) ──
if exist ".git\index.lock" del /f /q ".git\index.lock"
if exist ".git\HEAD.lock" del /f /q ".git\HEAD.lock"
if exist ".git\objects\maintenance.lock" del /f /q ".git\objects\maintenance.lock"

REM ── stage + commit any uncommitted changes (no-op if nothing to commit) ──
git add -A
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Local working tree commit"
)

REM ── push whatever's ahead of origin ──
git push origin main
echo DONE
pause
