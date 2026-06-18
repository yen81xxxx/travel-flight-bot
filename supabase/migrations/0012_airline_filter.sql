-- ============================================================
-- 航司過濾 — subscriptions.airline_filter
-- ============================================================
--
-- 讓使用者勾選「只追這幾家航空」，系統就只在勾選的航司裡找最便宜。
-- 存 displayName 陣列（'星宇航空' / '長榮航空' / '捷星' / '酷航'）。
-- NULL / 空陣列 = 不過濾，追全部白名單航司（= 舊行為，既有訂閱不受影響）。
--
-- 完全 additive。不要了直接 DROP COLUMN 零影響。
--
-- ⚠️ 在 Supabase SQL Editor 跑這段一次，最後跑 NOTIFY 那行。
-- ============================================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS airline_filter TEXT[];

NOTIFY pgrst, 'reload schema';
