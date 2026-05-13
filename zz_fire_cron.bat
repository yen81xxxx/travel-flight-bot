@echo off
chcp 65001 > nul
echo Triggering /api/cron/daily-search now...
echo.
curl -X POST "https://travel-flight-bot.vercel.app/api/cron/daily-search" ^
  -H "Authorization: Bearer cec86de1c879c995805a1a73de336bc1bcd5d9d4d08d1dc16718fd4c5593e1d0" ^
  --max-time 90 -w "\n\nHTTP %%{http_code}\n"
echo.
echo DONE
pause
