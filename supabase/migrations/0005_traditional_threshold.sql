-- ============================================
-- 訂閱可選「傳統航空另設目標價」
-- 方案 B：max_price 是主目標價（廉航 + 預設套用兩類），
--        max_price_traditional 是選填覆寫（傳統航空專用）
-- ============================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS max_price_traditional NUMERIC(10, 2);

COMMENT ON COLUMN subscriptions.max_price_traditional IS
  '傳統航空另設目標價（NULL = 跟隨 max_price）';
