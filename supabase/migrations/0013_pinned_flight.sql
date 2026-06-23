-- ============================================================
-- 釘選特定航班 — subscriptions.pinned_flight_number / pinned_flight_label
-- ============================================================
--
-- 讓使用者從航班清單點一班「就追這班」(方案 B)。
--   pinned_flight_number：比對 key，例 'GK 13'（= flight_quotes.raw.flights[0].flight_number）
--   pinned_flight_label ：顯示快照，例 '捷星 · 08:30'（那班從資料消失時仍顯示得出）
--
-- NULL = 沒釘選 → 照舊追整條線（最便宜 / 航司過濾 / 時段過濾）。
-- 有值 → analyzeFlights 只看那一班；找不到 → 當天不報價、不誤報。
-- 釘選優先於航司/時段過濾（釘一班已最精確）。
--
-- 完全 additive。不要了直接 DROP COLUMN 零影響。
--
-- ⚠️ 在 Supabase SQL Editor 跑這段一次，最後跑 NOTIFY 那行。
-- ============================================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS pinned_flight_number TEXT,
  ADD COLUMN IF NOT EXISTS pinned_flight_label  TEXT;

NOTIFY pgrst, 'reload schema';
