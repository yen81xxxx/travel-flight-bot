@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

set SUPABASE_URL=https://evyyvdymygzxjbzuzapm.supabase.co
set SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2eXl2ZHlteWd6eGpienV6YXBtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODIxNDA3NiwiZXhwIjoyMDkzNzkwMDc2fQ.hvHd9plHlVJ9vBNcubUCBmCKD2di1LSgi4JEEwF8i_w
set CRON_SECRET=cec86de1c879c995805a1a73de336bc1bcd5d9d4d08d1dc16718fd4c5593e1d0
set BASE=https://travel-flight-bot.vercel.app

echo ========================================
echo  1. Recent search_runs (last 10)
echo ========================================
curl -s -H "apikey: %SUPABASE_KEY%" -H "Authorization: Bearer %SUPABASE_KEY%" ^
  "%SUPABASE_URL%/rest/v1/search_runs?select=id,triggered_by,source_id,status,started_at,finished_at,error_message&order=started_at.desc&limit=10"
echo.
echo.

echo ========================================
echo  2. cron-triggered runs (last 10)
echo ========================================
curl -s -H "apikey: %SUPABASE_KEY%" -H "Authorization: Bearer %SUPABASE_KEY%" ^
  "%SUPABASE_URL%/rest/v1/search_runs?select=id,triggered_by,status,started_at,error_message&triggered_by=eq.cron&order=started_at.desc&limit=10"
echo.
echo.

echo ========================================
echo  3. Active subscriptions
echo ========================================
curl -s -H "apikey: %SUPABASE_KEY%" -H "Authorization: Bearer %SUPABASE_KEY%" ^
  "%SUPABASE_URL%/rest/v1/subscriptions?select=id,source_id,origin,destination,outbound_date,return_date,max_price,active,paused,last_notified_at&active=eq.true&order=id.desc"
echo.
echo.

echo ========================================
echo  4. notification_settings (all rows)
echo ========================================
curl -s -H "apikey: %SUPABASE_KEY%" -H "Authorization: Bearer %SUPABASE_KEY%" ^
  "%SUPABASE_URL%/rest/v1/notification_settings?select=*"
echo.
echo.

echo ========================================
echo  5. notifications (last 10)
echo ========================================
curl -s -H "apikey: %SUPABASE_KEY%" -H "Authorization: Bearer %SUPABASE_KEY%" ^
  "%SUPABASE_URL%/rest/v1/notifications?select=id,source_id,subscription_id,price_at_notify,message,sent_at&order=sent_at.desc&limit=10"
echo.
echo.

echo ========================================
echo  6. Manually trigger /api/cron/daily-search NOW (force-run)
echo  (will push today's daily summary if it works)
echo ========================================
echo Press any key to continue, or Ctrl+C to skip...
pause > nul
curl -X POST "%BASE%/api/cron/daily-search" ^
  -H "Authorization: Bearer %CRON_SECRET%" ^
  --max-time 90 -w "\nHTTP %%{http_code}\n"
echo.

echo.
echo DONE
pause
