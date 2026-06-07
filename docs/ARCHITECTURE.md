# Architecture — Travel Flight Bot

> 給新人 30 分鐘讀完，能知道每個檔案在做什麼、改哪個會影響什麼。

## 1. 三大入口 + 資料流

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  ① Vercel Cron (every day 05:00 UTC = 13:00 台北)                  │
│         │                                                           │
│         ▼                                                           │
│    /api/cron/daily-search                                          │
│    └─ subscription-checker → 每筆訂閱跟 SerpApi 比價                 │
│       └─ 跌破 → flex-message → LINE Push                            │
│                                                                     │
│                                                                     │
│  ② LINE Webhook (user 在 LINE 對話 / 按 postback)                   │
│         │                                                           │
│         ▼                                                           │
│    /api/line/webhook                                                │
│    └─ bot-handler.ts → 解析訊息、查狀態、觸發查詢 / 改設定           │
│                                                                     │
│                                                                     │
│  ③ LIFF (LINE 內嵌 webview，使用者開「我的訂閱」等)                  │
│         │                                                           │
│         ▼                                                           │
│    /liff/search | /subscriptions | /settings (LIFF V2 React 頁)    │
│    └─ fetch /api/subscriptions PATCH                                │
│       └─ Supabase write                                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 2. Repo 目錄結構（只列重點檔）

```
travel-flight-bot/
├── README.md                          ← 30 秒 onboarding + env 清單
├── docs/
│   ├── ARCHITECTURE.md                ← 你正在看這篇
│   └── TROUBLESHOOTING.md             ← 「user 報 X → 看 Y」對照表
├── .claude/CLAUDE.md                  ← 專案規則 + 踩過的雷
├── .github/workflows/ci.yml           ← GitHub Actions CI（typecheck + jest + lint + build）
├── .husky/pre-commit                  ← 本機 commit 前自動驗證
├── supabase/migrations/               ← SQL migration（手動跑到 Supabase）
│   ├── 0001_initial.sql              ← 主要表結構
│   ├── 0002_subscriptions.sql
│   ├── 0003_pause_and_quiet_hours.sql
│   ├── 0004_notification_toggles.sql
│   ├── 0005_traditional_threshold.sql ← 廉航 / 傳統 個別目標價
│   ├── 0006_min_departure_time.sql    ← 起飛時間下限
│   └── 0007_max_departure_time.sql    ← 起飛時間上限（時段窗口）
├── scripts/                           ← 一次性 debug 腳本（看 scripts/README.md）
└── src/
    ├── app/                           ← Next.js App Router
    │   ├── page.tsx                   ← 首頁（公開的看板）
    │   ├── layout.tsx                 ← Root HTML wrapper
    │   ├── api/                       ← 後端 API
    │   │   ├── cron/daily-search/route.ts        ★ 排程核心
    │   │   ├── line/webhook/route.ts             ★ LINE 訊息入口
    │   │   ├── subscriptions/route.ts            ← 訂閱 CRUD
    │   │   ├── subscriptions/schema.ts           ← PATCH zod schema
    │   │   ├── subscriptions/history/route.ts    ← 歷史走勢
    │   │   ├── notification-settings/route.ts    ← 通知設定
    │   │   ├── search/route.ts                   ← LIFF 即時查
    │   │   ├── health/route.ts                   ← 健康檢查
    │   │   ├── group-info/route.ts               ← LINE 群組資訊
    │   │   └── version/route.ts                  ← 部署版本確認
    │   └── liff/                      ← LIFF 內嵌頁
    │       ├── search/SearchFormV2.tsx           ← 查機票表單
    │       ├── subscriptions/SubscriptionsViewV2.tsx ★ 「我的訂閱」 + 編輯
    │       ├── settings/SettingsViewV2.tsx        ← 靜音時段、開關
    │       └── TabNav.tsx                         ← LIFF 共用 tab bar
    ├── lib/                           ← 核心業務邏輯
    │   ├── serpapi.ts                 ★ SerpApi 客戶端 + multi-key 輪換
    │   ├── flights.ts                 ★ analyzeFlights、time filter
    │   ├── cron-items-mapper.ts       ★ cron 把 (sub, route) → MultiSubsItem
    │   ├── subscription-checker.ts    ★ 比 max_price、推 LINE alert
    │   ├── flex-message.ts            ← LINE Flex Message 卡片組裝
    │   ├── bot-handler.ts             ← LINE webhook 訊息解析 + 狀態機
    │   ├── line.ts                    ← LINE Messaging API client
    │   ├── supabase.ts                ← Supabase client（service role）
    │   ├── cleanup.ts                 ← 30 天 retention + 配額統計
    │   ├── state.ts                   ← conversation_state 表的 helper
    │   └── security.ts                ← LINE webhook 簽名驗證
    ├── config/
    │   ├── airports.ts                ← IATA 機場資料（TPE / HND 等）+ 多機場 fan-out
    │   └── airlines.ts                ← 監控的白名單航司
    ├── components/                    ← LIFF UI 元件（iOS 風）
    │   ├── Alert.tsx, Badge.tsx, Button.tsx, Card.tsx, EmptyState.tsx,
    │   ├── Spinner.tsx, Stepper.tsx
    │   └── index.ts                   ← barrel export
    ├── hooks/                         ← React hooks
    │   ├── useLiff.ts                 ← LIFF SDK 包裝
    │   ├── useSessionStorage.ts      ← sessionStorage 同步
    │   ├── useKnownGroupCtxs.ts       ← 記住進過的群組 ctx
    │   ├── useForm.ts                 ← 表單驗證
    │   └── useSearchSession.ts       ← SearchForm 多步驟狀態
    ├── types/index.ts                 ← 全部共用 type
    └── styles/                        ← 全域 CSS
```

★ = 業務邏輯熱點，改之前一定要看測試

## 3. 關鍵流程詳解

### A. Cron 每日推播流程

```
/api/cron/daily-search 收到 POST (Authorization: Bearer CRON_SECRET)
   │
   ├─ 1) 撈所有 active + unpaused subscriptions
   │  └─ 過濾掉 outbound_date 已過期的 (auto-archive)
   │
   ├─ 2) 過濾掉 daily_summary=false 的 source
   │
   ├─ 3) 按 (origin, dest, outbound, return) 分組 dedup
   │    避免同條路線多筆訂閱重複打 SerpApi
   │
   ├─ 4) 對每組 route 平行 fetch:
   │  ├─ a) queryPreviousCategoryMins() → 撈昨日 baseline 算 ↑↓%
   │  └─ b) searchFlights() → SerpApi 6h cache 或新查
   │     ├─ 多機場城市 fan-out (東京 = HND + NRT)
   │     └─ multi-key rotation (429 → 換下一支)
   │
   ├─ 5) 對每筆 sub 套用自己的時段窗口、跨機場挑最便宜:
   │  └─ cron-items-mapper.ts → buildMultiSubsItem()
   │     回傳 MultiSubsItem 給 flex-message 組卡
   │
   ├─ 6) 按 source 分組推播一張 Carousel
   │
   ├─ 7) 寫一筆 search_runs 紀錄
   │
   ├─ 8) 跑 subscription-checker → 比 max_price → 跌破推 alert
   │
   └─ 9) cleanup 30 天 retention + 算配額剩餘
```

### B. LINE Webhook 流程

```
LINE 傳訊 → /api/line/webhook
   │
   ├─ 1) security.verifySignature() 驗 x-line-signature
   │
   ├─ 2) bot-handler.ts handleEvent():
   │  ├─ MessageEvent（user 打字）
   │  │  └─ 解析「查 TPE NRT 2027-02-04 2027-02-08」格式
   │  │     ├─ matches → 觸發 searchFlights + flex-message 回
   │  │     └─ 不 match → 查 conversation_state，可能在等使用者回答日期
   │  │
   │  ├─ PostbackEvent（user 按卡片按鈕）
   │  │  └─ data 帶 a=h（看歷史走勢）→ fetchHistoryByCategory + buildHistoryFlex
   │  │
   │  └─ FollowEvent / JoinEvent → 回 welcome 訊息
```

### C. LIFF 訂閱編輯流程

```
LINE「我的訂閱」按鈕 → 開 LIFF /liff/subscriptions
   │
   ├─ SubscriptionsViewV2.tsx fetch /api/subscriptions?sourceId=X
   │
   ├─ User 按某張卡的「編輯」
   │  └─ openEditModal(sub) → 顯示 modal
   │     ├─ 主目標價 input
   │     ├─ ☑ 傳統航空另設 → 第二個 input
   │     └─ ☑ 限制起飛時段 → 4 個 time input（去/回 各自不早於/不晚於）
   │
   ├─ User 按儲存 → submitEditPrice()
   │  ├─ normalizeHHMM() 容錯處理 '12' / '1200' / '12:00'
   │  ├─ min <= max 一致性檢查
   │  └─ fetch PATCH /api/subscriptions
   │     └─ schema.ts PatchBody.parse() zod 驗 HH:MM regex
   │        └─ buildPatchUpdatePayload() → undefined/null/value 三態
   │           └─ supabase.update(...)
   │
   └─ 成功 → 更新 local state、關 modal
```

## 4. 資料庫表

| 表 | 用途 | 重要欄位 |
|---|---|---|
| `subscriptions` | 使用者訂閱 | source_id, origin, destination, outbound_date, return_date, max_price, max_price_traditional, outbound_min/max_departure_time, return_min/max_departure_time, paused, active |
| `flight_quotes` | SerpApi 抓回的航班快取（30 天 retention） | origin, destination, dates, airline, price, stops, trip_leg, raw (JSONB), queried_at |
| `search_runs` | cron 跑的歷史紀錄 | triggered_by, status, serpapi_calls, error_message, duration_ms |
| `notifications` | 已推播的降價通知 | subscription_id, source_id, price_at_notify, message |
| `notification_settings` | 每個 source 的個人設定 | source_id, quiet_start, quiet_end, daily_summary, price_alerts |
| `conversation_state` | LINE bot 對話狀態 | source_id, state, context (JSONB) |
| `users` | LINE 使用者基本資料 | line_user_id, display_name |

## 5. 多 SerpApi key 輪換

```
SERPAPI_KEYS=keyA,keyB,keyC
                ↓
loadSerpApiKeys() → ['keyA', 'keyB', 'keyC']
                ↓
callSerpApi(query):
   rotateKeys(keys, exhaustedSet, key => fetchWithKey(key, query))
                ↓
   for each key not in exhaustedSet:
     try fetchWithKey(key)
     if 429 → exhaustedSet.add(key), continue
     if success → return
     if other error → throw (不換 key)
                ↓
   全部 429 → throw AllKeysExhaustedError
```

cron / subscription-checker 接到 AllKeysExhaustedError → 設 flag 停止後續 routes，省剩下的配額。

## 6. 測試覆蓋（目前 81 個）

| 測試檔 | 覆蓋 | 場景 |
|--------|------|------|
| `src/lib/__tests__/flights-time-filter.test.ts` | analyzeFlights time filter | 16 cases — min/max 邊界、cross-leg、fail-open |
| `src/lib/__tests__/serpapi-rotation.test.ts` | rotateKeys | 12 cases — 429 換 key、exhausted 跨 call 共用、非配額錯誤直拋 |
| `src/lib/__tests__/cron-items-mapper.test.ts` | buildMultiSubsItem | 20 cases — 5 種空狀態、多機場 fanout、LCC vs Trad 比價、vsPrev 零除 |
| `src/app/api/subscriptions/__tests__/route.test.ts` | PATCH schema + payload | 33 cases — HH:MM 邊界、undefined vs null、欄位數量回歸檢查 |

加新功能時順手補測試到對應檔。

## 7. 部署版本標記

每次改卡片版面或關鍵邏輯時 bump cardVersion 兩處：
- `src/app/api/version/route.ts`
- `src/app/api/cron/daily-search/route.ts`（response 內）

部署後 curl `/api/version` 確認 cardVersion 字串符合預期 → 知道 Vercel 真的部署到新 code。

## 8. SerpApi 配額管理

- Free tier = **250 calls / month / 帳號**
- 真實計數：search_runs.serpapi_calls 在 v40 後**包含失敗的 calls**（先 +1 再 await）
- 多 key 輪換可堆疊：兩支 free key = 500/月
- 觀察：`scripts/diagnose-no-data.mjs` 列本月用量
