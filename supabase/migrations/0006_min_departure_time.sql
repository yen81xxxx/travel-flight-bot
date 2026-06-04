-- ============================================
-- 0006 — 每筆訂閱可獨立設定「最早起飛時間」
-- 用途：排除清晨/凌晨航班（例如 5 AM）的降價通知與每日總表
-- 去程與回程可獨立設定，NULL = 不過濾
-- 格式 'HH:MM' (00:00 ~ 23:59)
-- ============================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS outbound_min_departure_time TEXT,
  ADD COLUMN IF NOT EXISTS return_min_departure_time TEXT;

-- PostgREST 立刻 reload schema cache（不用等 1〜2 分鐘）
NOTIFY pgrst, 'reload schema';
