-- ============================================
-- 訂閱降價提醒
-- 在 Supabase SQL Editor 執行
-- ============================================

CREATE TABLE IF NOT EXISTS subscriptions (
  id              BIGSERIAL PRIMARY KEY,
  source_id       TEXT NOT NULL,            -- LINE userId (U...) 或 groupId (C...)
  source_type     TEXT NOT NULL DEFAULT 'user',  -- 'user' | 'group' | 'room'
  origin          TEXT NOT NULL,
  destination     TEXT NOT NULL,
  -- 日期可選：null = 任何日期都通知
  outbound_date   DATE,
  return_date     DATE,
  -- 價格門檻
  max_price       NUMERIC(10, 2) NOT NULL,
  currency        TEXT DEFAULT 'TWD',
  -- 狀態
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  last_notified_at TIMESTAMPTZ,             -- 上次通知時間，避免狂發
  last_notified_price NUMERIC(10, 2),       -- 上次通知時的價格
  -- 顯示用標籤
  label           TEXT,                     -- 自訂名稱
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_source
  ON subscriptions (source_id, active);

CREATE INDEX IF NOT EXISTS idx_subscriptions_route
  ON subscriptions (origin, destination, active);

ALTER TABLE subscriptions DISABLE ROW LEVEL SECURITY;

-- ============================================
-- 通知紀錄（用來避免重複通知）
-- ============================================

CREATE TABLE IF NOT EXISTS notifications (
  id              BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT REFERENCES subscriptions(id) ON DELETE CASCADE,
  source_id       TEXT NOT NULL,
  message         TEXT,
  price_at_notify NUMERIC(10, 2),
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_sub
  ON notifications (subscription_id, sent_at DESC);

ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
