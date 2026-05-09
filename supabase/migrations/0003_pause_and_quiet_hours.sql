-- ============================================
-- 加暫停功能 + 通知靜音時段
-- ============================================

-- 訂閱：加 paused 欄位（暫停 ≠ 刪除）
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS paused BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_subscriptions_active_paused
  ON subscriptions (active, paused);

-- 通知設定：每個 source（個人或群組）一筆
CREATE TABLE IF NOT EXISTS notification_settings (
  source_id      TEXT PRIMARY KEY,
  quiet_start    TIME,                    -- 例：'22:00'
  quiet_end      TIME,                    -- 例：'08:00'
  timezone       TEXT NOT NULL DEFAULT 'Asia/Taipei',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE notification_settings DISABLE ROW LEVEL SECURITY;
