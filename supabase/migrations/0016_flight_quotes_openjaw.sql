-- ============================================================
-- 開口式 multi-city 報價存進 flight_quotes — return_origin / return_destination
-- ============================================================
--
-- 開口式 = 一張多城市票，整程總價 (searchMultiCity)。要在 LIFF「我的訂閱」顯示
-- 目前價 + 走勢，就得每天把整程價存進 flight_quotes（=歷史來源）。
--
-- 加兩欄區分「開口式整程報價」vs 一般對稱來回報價（不然 key 會撞）：
--   一般報價：return_origin / return_destination 皆 NULL
--   開口式報價：origin/destination/outbound_date = 去段；return_date = 回段日期；
--               return_origin/return_destination = 回段路線；price = 整程總價；
--               trip_leg = 'outbound'
--
-- 查詢開口式報價時用 (origin, destination, outbound_date, return_date,
-- return_origin, return_destination) 當 key — 跟一般報價（兩欄 NULL）天然不撞。
--
-- ⚠️ 在 Supabase SQL Editor 跑一次，最後跑 NOTIFY。
-- ============================================================

ALTER TABLE flight_quotes
  ADD COLUMN IF NOT EXISTS return_origin      TEXT,
  ADD COLUMN IF NOT EXISTS return_destination TEXT;

NOTIFY pgrst, 'reload schema';
