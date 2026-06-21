# Project-specific rules — Travel Flight Bot

繼承 `~/.claude/CLAUDE.md` 的 12 條全域規則，**另外**加這些專案規則：

## Workflow（最重要 — 防止改 A 壞 B）

1. **不直接推 main** — 一律推到 feature branch (`claude/sharp-hertz-423515` 或新 branch)，開 PR
2. **PR description 明列**：改了哪些檔案、改的原因、可能影響哪些功能
3. **commit 前必過 pre-commit hook** (`.husky/pre-commit`) — typecheck + jest
   - 失敗就修，**不要用** `--no-verify` 繞過
4. **GitHub Actions CI 必須綠燈才 merge** — main 設 branch protection
5. **改任一 schema** (DB / type / API / zod) → 同步：DB migration + types/index.ts + API + LIFF UI + 測試
   - 一個漏 = 上線翻車（之前 max_price_traditional 一次踩過、time-filter 一次踩過）
6. **改完一定「實際驗證過」才跟 user 說好了**（user 反覆強調的鐵則）
   - **typecheck / jest 綠 ≠ 功能 OK**。merge + 部署後要**實際操作那個功能一遍**才回報
   - 驗證擇一：對 prod 端到端腳本（建測試資料 → 操作 API → 讀回確認 → 清理）、`npm run e2e`、或真的在 LIFF / LINE 點一遍
   - **誠實回報實測結果**：測了什麼、看到什麼數字。沒測就說沒測，**禁止**講「應該沒問題」
   - 血淚教訓：時段過濾「存了畫面沒變」就是只看 CI 綠沒實測 → 被 user 抓到（後端其實是對的，前端清單沒套）

## 部署 / 版本

- **bump `cardVersion`**：改 cron 或卡片版面時更新 `/api/version` 跟 cron route 兩處
- **記得 bump 兩個地方**：`src/app/api/version/route.ts` + `src/app/api/cron/daily-search/route.ts`
- 部署 = push main → Vercel 自動 build
- 環境變數改了**不會**自動 redeploy；手動 trigger 或推任意 commit

## DB / Supabase

- 全部走 service-role key、RLS 關閉
- migration 編號 `supabase/migrations/000N_description.sql`
- 改 schema 後**手動跑 SQL**（Supabase SQL Editor）— 沒有自動 migrate
- 跑完加 `NOTIFY pgrst, 'reload schema';` 強制 PostgREST reload cache

## SerpApi

- 配額 = **per HTTP request**，不管成功失敗
- `serpapi_calls` counter 必須在 `await fetch` **之前** +1（修過一次，別退回）
- 多 key 輪換：`SERPAPI_KEYS=k1,k2,k3`（逗號分隔），429 自動跳下一支
- 收到 429 → 該 key 標 in-process exhausted Set；全部用完 throw `AllKeysExhaustedError`
- cron / sub-checker 接到 `AllKeysExhaustedError` → 立刻停止後續 routes（節省剩餘配額）

## flight_quotes 表

- 只存「直飛」(stops=0)；**2026-06-18 起無航司白名單**（有直飛就存；`config/airlines` 只負責廉/傳分類與顯示名，未分類航空照樣被追蹤+可勾選）
- `raw.flights[0].departure_airport.time` 是 `'YYYY-MM-DD HH:MM'` 格式
  （`inspect-time-format.mjs` 驗證過 50/50 樣本一致）
- 30 天 retention 自動清舊資料
- vsPrev delta 用 2〜36 小時前的舊 quote 當 baseline（不能套時段過濾，那段資料沒存 raw）

## 圓桌準則 / 設計慣例

- IATA 三碼路線顯示
- ISO 8601 日期
- 'HH:MM' 24 小時時間（zero-pad 兩位）
- LCC mix-and-match (捷星去 + 酷航回) vs Traditional 同家來回（星宇 / 長榮）
- LIFF 用 iOS Dark Mode design tokens（單一來源：`src/app/liff/_styles/tokens.css`）
- 顏色語意（與 tokens.css 對齊）：
  - `#30d158` 綠 = 成功 / 監控中
  - `#ff9f0a` 橘 = 警告 / 配額暫滿（iOS 系統色；2026-06-09 之前舊版寫 `#f59e0b`，已統一）
  - `#ff453a` 紅 = 危險 / 取消
  - `#0a84ff` 藍 = 動作（編輯、改價）
  - `#bf5af2` 紫 = 群組情境
  - `#ffd60a` 黃 = 傳統航空
  - `#64d2ff` 青 = 廉航
- LIFF 圖示：**禁止 emoji**，一律走 `src/app/liff/_components/Icon.tsx`（PR #1 後規則）

## 測試

- 跑全套：`npm test`
- 跑單一：`npx jest <檔案路徑>`
- 加新功能 = 加新測試（特別是 `analyzeFlights` 衍生邏輯、API schema、cron mapper）
- 不要為了過 hook 而 `--no-verify`，問題該修
- **實際驗證**（Workflow #6 要求）：`npm run e2e`（`scripts/e2e/smoke.mjs` 對 prod 端到端 + 自我清理），或自寫一次性腳本建測試資料 → 打 API → 讀回確認 → `delete` 清掉。單測綠不算驗證過。

## 重要的「曾經踩過 / 別再踩」清單

1. **空字串 vs null vs undefined** — DB 用 null、JS undefined 表「不動」、空字串通常是 bug
2. **`serpapiCalls++` 放對位置** — 必須在 await 之前，否則失敗的 call 漏算
3. **cardVersion 兩處同步** — version endpoint 跟 cron route
4. **新加 DB column → 提醒 user 跑 SQL migration** — 上次有 user 沒跑卡住
5. **改 type / signature → grep 所有 callers** — Subscription type 加欄位時、analyzeFlights 改參數時
6. **多機場 fan-out (東京 = HND + NRT)** — 任何「對 destination 查」的地方都要走 `getCityAirports()`
7. **trip_leg = outbound / return** 語義要對：
   - outbound.price = 「該航司同家來回」估算
   - return.price = 「outbound+return 配對」的精確總價
   - 拿錯會虛報價格差距
