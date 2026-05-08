-- ============================================
-- Travel Flight Bot — Initial Schema
-- 在 Supabase 的 SQL Editor 執行這份 migration
-- ============================================

-- 對話狀態：每個 LINE userId / groupId 的當前狀態
CREATE TABLE IF NOT EXISTS conversation_state (
  source_id      TEXT PRIMARY KEY,           -- LINE userId (U...) or groupId (C...)
  state          TEXT NOT NULL DEFAULT 'idle',
  context        JSONB DEFAULT '{}'::jsonb,  -- 暫存的搜尋條件等
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversation_state_updated
  ON conversation_state (updated_at);

-- 航班報價（同時當查詢結果快取 + 歷史紀錄）
CREATE TABLE IF NOT EXISTS flight_quotes (
  id               BIGSERIAL PRIMARY KEY,
  origin           TEXT NOT NULL,
  destination      TEXT NOT NULL,
  outbound_date    DATE NOT NULL,
  return_date      DATE,                    -- NULL = 單程
  airline          TEXT,
  airline_code     TEXT,
  price            NUMERIC(10, 2),
  currency         TEXT DEFAULT 'TWD',
  duration_minutes INT,
  stops            INT DEFAULT 0,           -- 0 = 直飛
  flight_type      TEXT NOT NULL,           -- 'best' | 'other'
  trip_leg         TEXT NOT NULL,           -- 'outbound' | 'return'
  raw              JSONB,                   -- SerpApi 原始物件
  queried_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 主要查詢索引（用來判斷是否有 6 小時內的快取）
CREATE INDEX IF NOT EXISTS idx_flight_quotes_lookup
  ON flight_quotes (origin, destination, outbound_date, return_date, queried_at DESC);

-- 依航空公司分組查詢用
CREATE INDEX IF NOT EXISTS idx_flight_quotes_airline
  ON flight_quotes (airline_code, queried_at DESC);

-- 每日搜尋執行紀錄（觀測用）
CREATE TABLE IF NOT EXISTS search_runs (
  id               BIGSERIAL PRIMARY KEY,
  triggered_by     TEXT NOT NULL,           -- 'cron' | 'line' | 'manual'
  source_id        TEXT,                    -- LINE 觸發時填 userId/groupId
  origin           TEXT,
  destination      TEXT,
  outbound_date    DATE,
  return_date      DATE,
  status           TEXT NOT NULL,           -- 'success' | 'cached' | 'failed'
  error_message    TEXT,
  serpapi_calls    INT DEFAULT 0,
  duration_ms      INT,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_search_runs_started
  ON search_runs (started_at DESC);

-- 使用者（之後做訂閱用，目前只記錄誰用過）
CREATE TABLE IF NOT EXISTS users (
  id               BIGSERIAL PRIMARY KEY,
  line_user_id     TEXT UNIQUE NOT NULL,
  display_name     TEXT,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_active_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 關閉 RLS（這個專案的所有寫入都從 server-side 走 service-role key）
ALTER TABLE conversation_state DISABLE ROW LEVEL SECURITY;
ALTER TABLE flight_quotes      DISABLE ROW LEVEL SECURITY;
ALTER TABLE search_runs        DISABLE ROW LEVEL SECURITY;
ALTER TABLE users              DISABLE ROW LEVEL SECURITY;
