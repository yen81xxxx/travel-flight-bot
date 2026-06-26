-- ============================================================
-- 開口式「釘去程班」報價 — flight_quotes.pinned_outbound_flight
-- ============================================================
--
-- 開口式查價會列出多組「來回組合」（去程各班 + 整趟總價）。使用者可以「釘」其中
-- 一個去程班去追（例：釘 中華 16:25 CI 106）。釘班 sub 追蹤的是「那一班的整趟價」，
-- 跟「追整程最便宜」的 sub 不同價。
--
-- 同一條開口式路線上，若一個 sub 追最便宜、另一個釘 CI 106，兩筆整趟價會同時存進
-- flight_quotes（route key 一樣）。加這欄區分：
--   pinned_outbound_flight IS NULL  → 一般 / 最便宜組合（追整程最低）
--   pinned_outbound_flight = 'CI 106' → 釘了去程 CI 106 那班的整趟價
--
-- 讀取（with-quotes / 6h 快取）依此欄過濾，釘班 sub 各拿各的、不互相覆蓋。
--
-- ⚠️ 在 Supabase SQL Editor 跑一次，最後跑 NOTIFY。
-- ============================================================

ALTER TABLE flight_quotes
  ADD COLUMN IF NOT EXISTS pinned_outbound_flight TEXT;

NOTIFY pgrst, 'reload schema';
