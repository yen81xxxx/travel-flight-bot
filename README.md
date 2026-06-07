# Travel Flight Bot

台灣 ↔ 日本 機票價格追蹤的 LINE Bot。每天爬 Google Flights、跌破設定的價格門檻自動 LINE 推播。

## 30 秒搞懂這專案在幹嘛

```
        ┌─ Vercel Cron (每天 05:00 UTC) ──→ /api/cron/daily-search ──┐
        │                                                            │
        │                                                            ▼
   SerpApi ◄──── 6h cache ────► Supabase ◄──── flight_quotes 表
        │                                                            │
        ▼                                                            │
   分析最便宜廉航 / 傳統 ──→ 跟 user 的 max_price 比 ──→ LINE Push    │
                                                                     │
   LINE webhook (user 輸入 / postback) ──→ /api/line/webhook ────────┘
                                          │
                                          ▼
                                   bot-handler.ts 處理對話狀態 + 觸發查詢

   LIFF (next.js 內嵌頁) ──→ /liff/search/subscriptions/settings → 改設定走 /api/subscriptions
```

**三大入口**：cron 每日推播、LINE webhook（user 對話）、LIFF 頁面（GUI 設定）。

## 跑起來 — 本機開發

### 環境需求
- Node.js 20+ (CI 也用 20，pre-commit 要一致)
- npm
- 一個 Supabase project + SerpApi key + LINE channel

### 設定步驟

```bash
git clone https://github.com/yen81xxxx/travel-flight-bot.git
cd travel-flight-bot
npm install                  # 第一次裝完會自動 setup husky pre-commit hook
cp .env.example .env.local   # 編輯填入實際 key（見下方清單）
npm run dev                  # http://localhost:3000
```

### 環境變數（`.env.local`）

| 變數 | 在哪拿 | 必填？ |
|------|------|-------|
| `SERPAPI_KEYS` | https://serpapi.com（每月 250 免費，**用兩支以上 逗號分隔**自動輪換） | ✅ |
| `SERPAPI_KEY` | 同上（單支 fallback、SERPAPI_KEYS 不存在時生效） | ⚠️ 二選一 |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL | ✅ |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 同上 → anon public | ✅ |
| `SUPABASE_SERVICE_ROLE_KEY` | 同上 → service_role（**保密**） | ✅ |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers → Channel → Messaging API | ✅ |
| `LINE_CHANNEL_SECRET` | LINE Developers → Channel → Basic settings | ✅ |
| `NEXT_PUBLIC_LIFF_ID` | LINE Developers → LIFF → Add → LIFF ID | ✅ |
| `NEXT_PUBLIC_APP_URL` | 部署後的 Vercel domain（本機填 `http://localhost:3000`） | ✅ |
| `CRON_SECRET` | 隨便產 32+ 字元的字串（[generator](https://generate-secret.vercel.app/32)） | ✅ |
| `LINE_DAILY_PUSH_TARGET` | LINE userId 或 groupId（沒人訂閱時的 fallback 推播目標） | ⚪ |
| `DEFAULT_ORIGIN` / `DEFAULT_DESTINATION` | IATA code（沒訂閱時 cron fallback 推播用） | ⚪ |

### 跑 DB migration

```sql
-- 第一次：到 Supabase SQL Editor，依序貼上跑：
-- 1) supabase/migrations/0001_initial.sql
-- 2) supabase/migrations/0002_subscriptions.sql
-- 3) ... 一直到 0007_max_departure_time.sql
NOTIFY pgrst, 'reload schema';
```

## 開發指令

| 指令 | 用途 |
|------|------|
| `npm run dev` | 本機跑 Next.js dev server |
| `npm run build` | Production build |
| `npm run typecheck` | TypeScript 型別檢查 |
| `npm test` | Jest 跑全部測試（目前 81 個） |
| `npm run lint` | ESLint（max 5 warnings） |
| `npm run dev` + 改檔 + `git commit` | pre-commit hook 自動跑 typecheck + jest + lint |

## 部署 — Vercel

1. Push 到 GitHub `main` branch（**main 有 branch protection，必須走 PR**）
2. Vercel 自動 detect、build、deploy
3. 環境變數要在 Vercel UI 設一份（**Settings → Environment Variables**）— 跟 `.env.local` 同步

> Env 改了**不會自動 redeploy**，要手動 redeploy 或推任意 commit。

## 工作流 — 改 code 的標準流程

```
1. git checkout -b claude/<topic>       # feature branch（不能直接動 main）
2. 改 code、跑 npm test 確認沒壞
3. git commit                            # pre-commit hook 自動 typecheck + jest + lint
4. git push origin claude/<topic>
5. 開 PR (GitHub UI 或 gh CLI)
6. CI 自動跑 typecheck / jest / lint / next build
7. CI 綠燈 → 自己 review → Merge
8. Vercel 自動部署 main
```

**main 已上鎖**：直接 `git push origin main` 會被 GitHub 拒絕（GH006）。

## 更深入

- 📐 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — 整套系統怎麼運作、各檔案職責
- 🔧 [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) — 「user 報 X 問題 → 看哪個檔、怎麼修」對照表
- 📜 [`.claude/CLAUDE.md`](.claude/CLAUDE.md) — 專案規則 + 踩過的雷清單
- 🔍 [`scripts/README.md`](scripts/README.md) — 7 個診斷腳本用途
