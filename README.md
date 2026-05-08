# Travel Flight Bot

東京便宜機票爬蟲 + LINE Bot + 即時看板。**取代原本 N8N 整套流程**。

## 架構速覽

```
┌──────────────────────────────────────────────┐
│  Vercel Cron (每天)                          │
│      ↓                                        │
│  /api/cron/daily-search                      │
│      ↓                                        │
└─────┬────────────────────────────────────────┘
      │
      ↓                          ┌──────────┐
   SerpApi  ←── 6h cache ──→  Supabase  ────→  / (Next.js page, ISR)
      │                          ↑   ↓
      ↓                          │   │
   分析結果                      │   │
      ↓                          │   │
   LINE Push                     │   │
                                 │   │
┌────────────────────────────────┘   │
│                                    │
│  LINE Webhook (使用者輸入)         │
│      ↓                              │
│  /api/line/webhook                  │
│      ↓                              │
│  狀態機 (Supabase) ─────────────────┘
│      ↓
│  搜尋 → push 結果
└─────────────────────────
```

## 功能對照（vs. 原本的 N8N）

| 功能 | N8N 節點 | 這裡的對應 |
|---|---|---|
| 每日排程 | Schedule Trigger | Vercel Cron + `/api/cron/daily-search` |
| 查 SerpApi 去程 | HTTP GET | `src/lib/serpapi.ts` |
| 查 SerpApi 回程 | HTTP GET | 同上（用 `departure_token`） |
| 篩選航空公司 | Code 節點 | `src/config/airlines.ts` |
| 分析最便宜 | Code 節點 | `src/lib/flights.ts` |
| 推 GitHub | HTTP PUT (有 SHA 衝突問題) | **不再需要**，改用 Next.js ISR |
| LINE 推播 | HTTP POST | `src/lib/line.ts` |
| LINE Webhook | Webhook Trigger | `/api/line/webhook` |
| 解析訊息 | Code 節點 | `src/lib/bot-handler.ts` |
| 對話狀態 | `$getWorkflowStaticData` | Supabase `conversation_state` 表 |
| 動作路由 | If/Switch | `src/lib/bot-handler.ts` |

## 部署 SOP

### Step 1：申請帳號

1. **Supabase**：到 https://supabase.com 註冊免費帳號 → 建立新專案
2. **Vercel**：到 https://vercel.com 註冊（用 GitHub 登入最方便）
3. **GitHub**：把這個資料夾推到一個 repo（之後 Vercel 從這 deploy）
4. **SerpApi 帳號**（沿用 N8N 那組就好，到 https://serpapi.com/manage-api-key 拿 key）
5. **LINE Developers Console**（沿用原本的 channel）

### Step 2：建立 Supabase schema

打開 Supabase → SQL Editor → 貼上 `supabase/migrations/0001_initial.sql` 內容 → Run。

### Step 3：本機跑起來測試

```bash
cd D:\Claud專案\Travel
npm install
cp .env.example .env.local
# 編輯 .env.local 把每一格填好（看下方 credentials checklist）
npm run dev
# 然後打開 http://localhost:3000
# 可以打開 http://localhost:3000/api/health 看是不是所有環境變數都齊了
```

### Step 4：部署 Vercel

```bash
# 推到 GitHub
git init
git add .
git commit -m "initial"
git remote add origin <your-github-repo>
git push -u origin main

# 然後在 Vercel 後台 → New Project → 選 repo → 把 .env.local 的內容
# 一一貼到 Project Settings → Environment Variables → Production
```

部署完會拿到一個網址，例如 `https://travel-xxx.vercel.app`

### Step 5：把 LINE Webhook 切到新網址

到 LINE Developers Console → 你的 Channel → Messaging API：
- **Webhook URL**：`https://travel-xxx.vercel.app/api/line/webhook`
- **Use webhook**：開啟
- 點 **Verify** 應該回 200 ✓

### Step 6：關掉 N8N

確認 LINE Bot 在新網址上能正常對話、隔天看到排程跑起來、看板有更新後，就把 N8N 那個 workflow deactivate。

## Credentials checklist（給 .env.local 的填法）

| 變數 | 在哪拿 |
|---|---|
| `SERPAPI_KEY` | https://serpapi.com/manage-api-key |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API → service_role（**保密**） |
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Developers → Channel → Messaging API → Channel access token |
| `LINE_CHANNEL_SECRET` | LINE Developers → Channel → Basic settings → Channel secret |
| `LINE_DAILY_PUSH_TARGET` | 你想推到哪個 user/group ID（沿用 N8N 用的那組）；不填則 broadcast |
| `CRON_SECRET` | 自己產一個 32+ 字元的隨機字串（[產生器](https://generate-secret.vercel.app/32)） |

## 開發指令

```bash
npm run dev         # 本機開發
npm run build       # 產生 production build
npm run start       # 跑 production build
npm run typecheck   # 只檢查型別
npm run lint        # 跑 ESLint
```

## 手動觸發測試

```bash
# 觸發排程（要帶 CRON_SECRET）
curl -X POST https://your-domain.vercel.app/api/cron/daily-search \
  -H "Authorization: Bearer YOUR_CRON_SECRET"

# 健康檢查
curl https://your-domain.vercel.app/api/health
```

## 架構亮點（和 N8N 比的改進）

1. **沒有 staticData 消失問題** — 對話狀態進 Postgres
2. **沒有 GitHub SHA 衝突** — 不再推 GitHub，前台直接從 DB 渲染
3. **6 小時快取** — 重複查詢省 SerpApi 配額
4. **LINE Webhook 簽名驗證** — 防止偽造請求
5. **Cron 用 secret** — 防止外人觸發
6. **每次搜尋有紀錄** — `search_runs` 表可以追失敗原因
7. **可橫向擴展** — Vercel 自動 scale，無需自己架 server
8. **Type-safe** — TypeScript 全程型別檢查
9. **可版控** — 全部 in code，Git diff 一目了然

## 之後可以做的事

- LINE Flex Message 把結果做成卡片
- LIFF 做日期選擇器
- 訂閱降價提醒（subscriptions 表）
- 多路線、多目的地（從 hardcoded 改成參數化）
- 歷史價格趨勢圖
- LINE Pay / Stripe 訂閱付費
