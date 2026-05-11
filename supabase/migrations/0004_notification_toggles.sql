-- ============================================
-- 每個 source 可獨立 toggle 兩種推播
-- ============================================

ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS daily_summary BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS price_alerts  BOOLEAN NOT NULL DEFAULT TRUE;
