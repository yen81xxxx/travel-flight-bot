@echo off
cd /d "%~dp0"
curl -s "https://travel-flight-bot.vercel.app/_next/static/chunks/app/liff/subscriptions/page-7e548cb5703a7abc.js" -o bundle.js
echo === bundle size ===
dir bundle.js | findstr "bundle.js"

echo.
echo === look for button className strings ===
findstr /o /c:"btn-edit" /c:"btn-label" /c:"btn-pause" /c:"btn-resume" /c:"btn-test" bundle.js > debug_btn.txt
type debug_btn.txt

echo.
echo === sample line containing btn-edit (from grep with surrounding chars) ===
powershell -Command "(Get-Content -Raw bundle.js) -match '.{60}btn-edit.{120}' | Out-Null; Write-Host $Matches[0]" 2>nul
