-- ============================================================
-- R4-C: click_event — 「我也要追」成效量測（群組病毒擴散指南針）
-- ============================================================
--
-- 目的：群組達標卡的「我也要追」按鈕到底有沒有人按，目前完全沒數據。
-- 群組卡連結帶 ?src=group-alert → LIFF 打開時 POST /api/track 記一筆。
--
-- 完全 additive：新表、不動任何既有表。評估完不要了直接 DROP TABLE 零影響。
-- 寫入只走 service-role（RLS 關閉 — 同專案所有表的慣例）。
--
-- ⚠️ 在 Supabase SQL Editor 跑這段一次，最後跑 NOTIFY 那行。
-- ============================================================

CREATE TABLE IF NOT EXISTS click_event (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 來源標記：'group-alert' = 群組達標卡的「我也要追」。之後加新來源直接用新字串。
  src TEXT NOT NULL,
  -- 群組 ctx（C... / R...）— 知道是哪個群組的卡帶來的
  ctx TEXT,
  -- 點的人（LINE userId）— 之後可比對 group_member 算「點了之後真的加入追蹤」轉換率
  line_user_id TEXT
);

-- 分析查詢都是「某 src 在某段時間的量」
CREATE INDEX IF NOT EXISTS idx_click_event_src_created
  ON click_event (src, created_at DESC);

NOTIFY pgrst, 'reload schema';
