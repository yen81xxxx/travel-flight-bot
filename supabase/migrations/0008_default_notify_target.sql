-- PR #4b: Settings 新增「新追蹤的預設通知對象」
--
-- 在群組情境內，使用者建立新追蹤時可以選「通知我」或「通知群組」。這個欄位
-- 是預設值（每次 AddWatchSheet 開啟時帶入這個選擇）。
--
-- 'me'    = 通知個人（subscribe with personal sourceId）
-- 'group' = 通知群組（subscribe with group ctx）
--
-- 預設 'me' — 多數情境（非群組打開、或不希望意外打擾群組）合理。
-- 群組打開的 LIFF user 可以在 SettingsSheet 改成 'group'。
ALTER TABLE notification_settings
  ADD COLUMN IF NOT EXISTS default_notify_target TEXT NOT NULL DEFAULT 'me'
    CHECK (default_notify_target IN ('me', 'group'));

-- PostgREST schema cache reload（user 跑完 SQL 後要看到新欄位才能用）
NOTIFY pgrst, 'reload schema';
