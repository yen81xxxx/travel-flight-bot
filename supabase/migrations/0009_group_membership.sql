-- ============================================================
-- G0: Group track foundation — shared watch records
-- ============================================================
--
-- 把「group 訂閱」從「只是個推播位址」升級成「多人共同擁有 + 多人狀態」。
-- 完全 additive：既有 subscriptions 仍能正常運作（source_type='group' 的訂閱
-- 之前是「一個人建立、全 LINE 群組看到推播」，現在多了 group_member 紀錄 +
-- 每人 accepted_target + consensus_rule + 日期投票）。
--
-- 退場策略：本 migration **只 ADD**，不改動任何既有欄位含義。如果之後群組
-- 功能評估不成功，可以保留資料表為空、回到「source_type='group' 就推 LINE 群組」
-- 的舊行為，0 破壞。
--
-- ⚠️ 在 Supabase SQL Editor 跑這段一次：
--    1. 依序執行下方所有 CREATE TABLE / CREATE INDEX / ALTER TABLE
--    2. 最後跑 NOTIFY pgrst, 'reload schema';
--    3. 確認 4 張 table 在 Database → Tables 看得到
-- ============================================================

-- ============================================
-- 1. subscriptions 加群組相關欄位
-- ============================================
ALTER TABLE subscriptions
  -- 共識規則：群組訂閱用，個人訂閱忽略此欄位
  --   'max'    = 全員 accepted_target 取最大（沒人會被價超出預算，保守、預設）
  --   'avg'    = 全員 accepted_target 取平均（折衷）
  --   'manual' = 不算共識，max_price 由建立者手動設
  ADD COLUMN IF NOT EXISTS consensus_rule TEXT
    CHECK (consensus_rule IN ('max', 'avg', 'manual')) DEFAULT 'max',
  -- 建立者 LINE userId — 用來查「誰最初開的」，但 NOT 用來控制權限
  --（group_watch 的設計是「沒有 owner」，任何 member 都能改）
  ADD COLUMN IF NOT EXISTS created_by_user_id TEXT;


-- ============================================
-- 2. group_member — 誰在追這個 group watch
-- ============================================
-- 一個 group 訂閱 + 多筆 member rows = 共同追蹤。
-- 個人訂閱 (source_type='user') 永遠 0 筆，不會用到這張表。
CREATE TABLE IF NOT EXISTS group_member (
  id               BIGSERIAL PRIMARY KEY,
  subscription_id  BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  line_user_id     TEXT NOT NULL,
  display_name     TEXT,
  -- 該成員自己能接受的價格上限 — 共識計算的 input
  -- NULL = 還沒設、跟著 derived target 走（不影響共識）
  accepted_target  NUMERIC(10, 2),
  joined_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 一個 user 在一個 group watch 內只能有一筆紀錄
  UNIQUE (subscription_id, line_user_id)
);

-- 「使用者打開 LIFF 看自己加入的 group watches」的核心查詢路徑
CREATE INDEX IF NOT EXISTS idx_group_member_user
  ON group_member (line_user_id);

-- 「展開一個 group watch 看誰在追」的反向路徑
CREATE INDEX IF NOT EXISTS idx_group_member_sub
  ON group_member (subscription_id);

ALTER TABLE group_member DISABLE ROW LEVEL SECURITY;


-- ============================================
-- 3. date_option — 群組想去的日期候選
-- ============================================
-- G3 才用，但 schema 一次到位（少一次 prod migration prompt）
CREATE TABLE IF NOT EXISTS date_option (
  id               BIGSERIAL PRIMARY KEY,
  subscription_id  BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  out_date         DATE NOT NULL,
  ret_date         DATE,                       -- NULL = 該選項是單程
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 同一群組同樣日期組合不重複（建立者點兩次「加日期」也只記一筆）
  UNIQUE (subscription_id, out_date, ret_date)
);

CREATE INDEX IF NOT EXISTS idx_date_option_sub
  ON date_option (subscription_id);

ALTER TABLE date_option DISABLE ROW LEVEL SECURITY;


-- ============================================
-- 4. date_vote — 群組成員的投票（哪個日期）
-- ============================================
-- 規則（重要）：
--   一個 user 在一個 group watch 內只能投一票。換選項 = UPDATE 既有 row
--   而非 INSERT。UNIQUE(subscription_id, line_user_id) 強制執行。
CREATE TABLE IF NOT EXISTS date_vote (
  id               BIGSERIAL PRIMARY KEY,
  date_option_id   BIGINT NOT NULL REFERENCES date_option(id) ON DELETE CASCADE,
  subscription_id  BIGINT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  line_user_id     TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- 一個 user 在一個 sub 只能投一次（同 person 換 option 用 UPSERT）
  UNIQUE (subscription_id, line_user_id)
);

-- 「展開一個選項看誰投了」
CREATE INDEX IF NOT EXISTS idx_date_vote_option
  ON date_vote (date_option_id);

ALTER TABLE date_vote DISABLE ROW LEVEL SECURITY;


-- ============================================
-- 5. PostgREST schema reload — 跑完 user 才會在 API 立刻看得到新欄位
-- ============================================
NOTIFY pgrst, 'reload schema';
