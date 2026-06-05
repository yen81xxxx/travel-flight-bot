-- ============================================
-- 0007 — 起飛時段窗口擴成 min ~ max
-- 0006 只有 min（不早於 X 點），無法處理「不想晚於 X 點起飛」的需求
-- 例：去程不晚於 12:00、回程不晚於 18:00
-- ============================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS outbound_max_departure_time TEXT,
  ADD COLUMN IF NOT EXISTS return_max_departure_time TEXT;

NOTIFY pgrst, 'reload schema';
