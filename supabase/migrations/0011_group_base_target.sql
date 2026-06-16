-- ============================================================
-- #5: base_max_price — 群組共識的「原始門檻基準」
-- ============================================================
--
-- Bug：群組共識把 derived target 寫進 subscriptions.max_price（cron 讀同欄）。
-- 當全員離開 / 沒人設 accepted_target 時，recomputeAndPersistDerived 算出
-- derived=null 就「不寫回」→ max_price 卡在最後一次的共識值，無法還原成
-- 建立者一開始設的門檻（原值早被共識蓋掉、無處可救）。
--
-- 修法：存一個 base_max_price = 建立者建立群組訂閱時的原始 max_price。
-- derived=null 時還原成 base_max_price，而不是留著舊共識值。
--
-- 完全 additive。個人訂閱忽略此欄位。
--
-- ⚠️ 在 Supabase SQL Editor 跑這段一次，最後跑 NOTIFY 那行。
-- ============================================================

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS base_max_price NUMERIC;

-- 既有群組訂閱回填：把目前 max_price 當基準（真正的原始值已不可考，
-- 用現值當 baseline 是最安全的選擇 — 至少全員離開時會還原成「現在這個值」）。
-- 個人訂閱不需要，留 NULL。
UPDATE subscriptions
  SET base_max_price = max_price
  WHERE source_type = 'group' AND base_max_price IS NULL;

NOTIFY pgrst, 'reload schema';
