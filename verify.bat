@echo off
cd /d "%~dp0"
echo === Health ===  > verify_result.txt
curl -s "https://travel-flight-bot.vercel.app/api/health" >> verify_result.txt
echo. >> verify_result.txt
echo. >> verify_result.txt

echo === Test paused column (should return rows or empty array, NOT error) === >> verify_result.txt
curl -s "https://evyyvdymygzxjbzuzapm.supabase.co/rest/v1/subscriptions?select=id,paused,active,label&limit=3" ^
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2eXl2ZHlteWd6eGpienV6YXBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODIxNDA3NiwiZXhwIjoyMDkzNzkwMDc2fQ.hvHd9plHlVJ9vBNcubUCBmCKD2di1LSgi4JEEwF8i_w" ^
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2eXl2ZHlteWd6eGpienV6YXBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODIxNDA3NiwiZXhwIjoyMDkzNzkwMDc2fQ.hvHd9plHlVJ9vBNcubUCBmCKD2di1LSgi4JEEwF8i_w" >> verify_result.txt
echo. >> verify_result.txt
echo. >> verify_result.txt

echo === Test notification_settings table === >> verify_result.txt
curl -s "https://evyyvdymygzxjbzuzapm.supabase.co/rest/v1/notification_settings?select=*&limit=3" ^
  -H "apikey: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2eXl2ZHlteWd6eGpienV6YXBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODIxNDA3NiwiZXhwIjoyMDkzNzkwMDc2fQ.hvHd9plHlVJ9vBNcubUCBmCKD2di1LSgi4JEEwF8i_w" ^
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2eXl2ZHlteWd6eGpienV6YXBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODIxNDA3NiwiZXhwIjoyMDkzNzkwMDc2fQ.hvHd9plHlVJ9vBNcubUCBmCKD2di1LSgi4JEEwF8i_w" >> verify_result.txt
echo. >> verify_result.txt

echo Done. Result saved to verify_result.txt
type verify_result.txt
