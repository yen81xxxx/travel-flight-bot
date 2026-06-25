-- ============================================================
-- 開口式來回（open-jaw）— return_origin / return_destination
-- ============================================================
--
-- 今天的「來回」是對稱的：去 origin→destination、回被假設成 destination→origin
-- （Google Flights round-trip 用 departure_token 查同一對機場）。
-- 使用者要的是「去 TPE→東京、回 羽田→松山」這種回程不同地點的開口式行程。
--
-- 設計：一筆開口式 = 兩段獨立單程
--   去段：origin → destination          @ outbound_date
--   回段：return_origin → return_destination @ return_date
--   合併價 = 兩段各自最低相加（開口式本來就沒對稱來回折扣）
--
-- 兩欄 NULL = 維持今天的對稱來回 / 單程行為（完全相容）。
-- 兩欄都有值 = 開口式（回段走獨立單程查詢）。
--
-- ⚠️ 在 Supabase SQL Editor 跑這段一次，最後跑 NOTIFY 那行。
-- ============================================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS return_origin      TEXT,
  ADD COLUMN IF NOT EXISTS return_destination TEXT;

NOTIFY pgrst, 'reload schema';
