-- ============================================================
-- 釘選航班「複選」— pinned_flight_numbers[] / pinned_flight_labels[]
-- ============================================================
--
-- 0013 是單選一班；user 要複選多班（卡片/警報列出勾選的每一班 + 各自價）。
-- 改成平行陣列：
--   pinned_flight_numbers[]：比對 key 陣列，例 {'GK 13','IT 201'}
--   pinned_flight_labels[] ：顯示快照陣列，例 {'捷星 · 08:30','台灣虎航 · 11:25'}
-- NULL / 空陣列 = 沒釘選 → 照舊追整條線。
--
-- 行為：分析時把陣列裡每個班號都撈出來；
--   - topAirlines = 勾選的每一班（列出來，不縮成最便宜）
--   - 觸發門檻用「最低那班」破線（總得有觸發條件）
--
-- 完全 additive。把舊的單欄 0013（pinned_flight_number）值搬進陣列第一格，
-- 舊單欄留著不刪（additive 慣例；程式改讀陣列）。
--
-- ⚠️ 在 Supabase SQL Editor 跑這段一次，最後跑 NOTIFY 那行。
-- ============================================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS pinned_flight_numbers TEXT[],
  ADD COLUMN IF NOT EXISTS pinned_flight_labels  TEXT[];

-- 把 0013 單選的既有值搬進陣列（1 格）。沒有資料就 no-op。
UPDATE subscriptions
SET pinned_flight_numbers = ARRAY[pinned_flight_number],
    pinned_flight_labels  = ARRAY[COALESCE(pinned_flight_label, pinned_flight_number)]
WHERE pinned_flight_number IS NOT NULL
  AND (pinned_flight_numbers IS NULL OR array_length(pinned_flight_numbers, 1) IS NULL);

NOTIFY pgrst, 'reload schema';
