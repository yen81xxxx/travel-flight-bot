# Troubleshooting — Travel Flight Bot

> 「使用者報 X 問題 → 看哪個檔、怎麼修」對照表。每條都附有實際發生過的案例。

---

## 🔴 LINE 卡片顯示「查無資料」或「⏸ 配額暫滿」

### 症狀
- LINE 群組收到每日卡片，但某幾條訂閱顯示 `⏸ 今日查詢額度暫滿` 或 `❌ 此條件無符合航班`

### 區分兩種情境

| 卡片訊息 | 顏色 | 真正原因 |
|---------|------|---------|
| `⏸ 今日查詢額度暫滿` | 橘黃 #f59e0b | SerpApi 全 key 配額用光 |
| `❌ 此條件無符合航班` | 灰 | SerpApi 有跑、但路線/日期真的沒符合白名單航司的直飛 |

### 配額用光時怎麼修

1. **跑診斷腳本** 看本月用量：
   ```bash
   node scripts/diagnose-no-data.mjs
   ```
2. **打 SerpApi /account 端點**確認真實額度（不算搜尋配額）：
   ```bash
   curl "https://serpapi.com/account?api_key=<your_key>"
   ```
3. **解決方案** 三選一：
   - 申請第二支 free key（不同 email），加進 Vercel env `SERPAPI_KEYS=k1,k2`
   - 升級 SerpApi 付費（$50 / 5000 calls）
   - 等月初 reset

### 沒符合航班時怎麼修

通常是這幾個原因：
- 目的地沒被監控的航司直飛（例如 SDJ 仙台只有星宇/長榮，沒有捷星）
- 日期太遠（Google Flights 通常只給 11 個月內）
- trip 太長（> 60 天，return token 可能拿不到）

→ **跑 `scripts/probe-serpapi.mjs`** 直打 SerpApi 看 raw response，確認到底是 0 results 還是 token 失敗。

---

## 🔴 user 改價儲存失敗：「Could not find column 'XXX' in schema cache」

### 症狀
LIFF 編輯 modal 按儲存 → alert 跳「儲存失敗：Could not find the 'outbound_max_departure_time' column of 'subscriptions' in the schema cache」

### 原因
新 migration 還沒在 Supabase 跑。SQL 檔在 repo 裡 `supabase/migrations/`，但**不會自動執行**。

### 修法
1. 去 Supabase Dashboard → SQL Editor → New query
2. 找 `supabase/migrations/000X_*.sql` 對應的檔
3. 貼進去按 Run
4. 結尾加 `NOTIFY pgrst, 'reload schema';` 強制 PostgREST reload cache（不然要等 1〜2 分鐘）

### 預防
**新加 DB 欄位的 checklist**（不照做下一定踩雷）：
- [ ] `supabase/migrations/000X_*.sql` 寫 ALTER TABLE
- [ ] `src/types/index.ts` Subscription type 加欄位
- [ ] `src/app/api/subscriptions/schema.ts` PatchBody zod 加欄位 + buildPatchUpdatePayload
- [ ] `src/app/liff/subscriptions/SubscriptionsViewV2.tsx` modal UI + state
- [ ] `src/app/api/cron/daily-search/route.ts` 跟 `src/lib/subscription-checker.ts` 帶到下游
- [ ] `src/lib/flex-message.ts` 卡片顯示
- [ ] `src/lib/__tests__/cron-items-mapper.test.ts` 加 case
- [ ] 提醒 user 跑 SQL migration

---

## 🔴 user 抱怨：「卡片顯示廉航 NT$ 13780，但點進去 Skyscanner 找不到那個價」

### 原因
SerpApi 的 outbound 列表 price 是 Google Flights 對「該航司同家來回」的估算總價，不是某次訂票實際金額。

### 確認方法
1. 跑 `scripts/inspect-jan30-feb4.mjs`（改裡面的日期、route）看 SerpApi raw data
2. 看 `q.raw.flights[0]` 的 `flight_number` + `departure_token`
3. 拿 token 重打 SerpApi 看實際 round-trip combo（會貴一些）

### 解釋
廉航的「精確配對價」要從 **return list** 拿（同 q.raw.flights[0].price），不能用 outbound list 的價。

### 程式裡哪邊處理
`src/lib/flights.ts` 的 `pickLccCombo()` — 預設用 return list price 當配對總價，return 沒廉航時 fallback 到 outbound 估算 + 標 `isEstimate: true`。

---

## 🔴 cron 跑了但沒推播 / serpapi_calls = 0

### 排查順序

1. **看 `search_runs` 表**最近 5 筆：
   ```sql
   SELECT * FROM search_runs ORDER BY started_at DESC LIMIT 5;
   ```

2. **status 欄看**：
   - `success` + `duration_ms` 短 + `serpapi_calls = 0` → cache 全 hit 或全 fail
   - `success` + 正常 duration + calls > 0 → 正常
   - `partial` → 部分 push 失敗，看 `error_message`

3. **如果 calls = 0 但短 duration**：
   - 可能是 cache 全 hit（6 小時內有資料）— 正常
   - 可能是 SerpApi 全部 429 throw（看 Vercel Logs `[serpapi] failed`）
   - **注意**：v40 之前的 serpapiCalls 計數有 bug（失敗的 call 沒計入），實際用量可能遠超 250

4. **Vercel Logs 看實際錯誤**：
   ```
   Vercel Dashboard → travel-flight-bot → Logs → 篩選 /api/cron/daily-search
   ```

---

## 🔴 LIFF 頁面打開白屏 / 卡 loading

### 常見原因 + 修法

| 症狀 | 原因 | 修法 |
|------|------|------|
| LIFF SDK 一直 loading | `NEXT_PUBLIC_LIFF_ID` 沒設或錯 | 確認 Vercel env + LINE Console LIFF ID 一致 |
| 「請從 LINE APP 內開啟」 | LIFF 不在 LINE 內呼叫 / iframe sandbox | 必須從 LINE app 內開（手機 / desktop LINE 都行）|
| `useLiff` hook 一直 not ready | LIFF init 失敗 | Chrome DevTools 看 console，通常是 LIFF endpoint URL 配錯 |
| 設定送出 PATCH /api/subscriptions 400 | sourceId 沒帶 / zod validation 失敗 | 看 Network tab → response 看 zod error 詳細 |
| 看不到自己訂閱 / 群組訂閱顯示 0 | sessionStorage 過期或 ctx 沒帶 | URL 加 `?ctx=Cxxxxxxx` 群組 ID |

---

## 🔴 GitHub Actions CI 紅燈 — 不能 merge PR

### 看 CI 失敗 step

| 失敗的 step | 通常原因 | 修法 |
|------------|---------|------|
| `TypeScript` | 改了 type/signature 沒 grep 所有 caller | 本機 `npm run typecheck`、`grep -rln "OldName" src/` |
| `Tests` | jest fail | 本機 `npm test -- <failing-file>` 看 |
| `Lint` | 新增 warning 超過 max-warnings=5 | 改用具體型別取代 `any`，或 inline `// eslint-disable-next-line` 註解 |
| `Build` | env 缺 / import 路徑錯 | CI 用 dummy env，build 用 lazy getSupabase 不該打 DB |

---

## 🔴 部署後行為跟預期不符（似乎是舊版）

### 確認步驟

1. **打 `/api/version`** 看當前 deployed cardVersion：
   ```bash
   curl https://travel-flight-bot.vercel.app/api/version
   ```
2. **跟 `src/app/api/version/route.ts` 對比** — 不一樣 = Vercel 還沒部署到最新
3. **觸發 redeploy**：Vercel Dashboard → Deployments → ⋯ → Redeploy
4. **常見原因**：env 變更但沒 redeploy（Vercel 不會自動）

### 預防
改 cron / 卡片版面時：
- 更新 `cardVersion` 兩處（version route + cron response）
- push main → 自動 build
- 等 build 完 → curl /api/version 確認

---

## 🔴 「我推 main 被 GitHub 拒絕了！GH006」

### 不是 bug，是 protection 在工作

> ```
> remote: error: GH006: Protected branch update failed for refs/heads/main.
> remote: - Changes must be made through a pull request.
> remote: - 2 of 2 required status checks are expected.
> ```

main 已強制 PR-only。**正確流程**：
```bash
git checkout -b claude/<topic>
git push -u origin claude/<topic>
gh pr create        # 或開 GitHub UI 開 PR
# CI 跑完綠燈 → Merge → Vercel 部署
```

### 真的緊急要繞過

Settings → Branches → 暫時 disable rule → 修 → 重啟。**唯一後門**，不要常用。

---

## 🔴 跑 cron 收到 `AllKeysExhaustedError`

### 原因
所有 SerpApi key 本月配額用光、cron 自動中止剩餘 routes。

### 修法（短期）
- 申請第三支 key 加進 `SERPAPI_KEYS`
- 把 cron 改成 2 天跑一次（在 `vercel.json` 改 cron schedule）

### 修法（長期）
- 升級 SerpApi 付費 $50/月
- 改用其他資料源（kayak/amadeus）

---

## 🟡 LIFF UI 看起來亂 / 不符 iOS Design

### 設計 tokens
`src/app/liff/subscriptions/SubscriptionsViewV2.tsx` 內有 iOS dark mode tokens 定義（`--ios-bg` `--ios-blue` 等）。**改顏色**直接編這檔的 `<style jsx>` 區塊。

### 顏色語意
| token | 用途 |
|-------|------|
| `#30d158` 綠 | 成功 / 監控中 |
| `#f59e0b` 橘 | 警告 / 配額暫滿 |
| `#ff453a` 紅 | 危險 / 取消 |
| `#0a84ff` 藍 | 動作（編輯、改價）|
| `#bf5af2` 紫 | 群組情境 |

---

## 🟡 我新加了一個功能，怎麼確認沒打到別的？

### 防回歸 checklist

1. **本機 commit 前**：pre-commit hook 自動跑 typecheck + jest + lint
2. **改 type / signature**：`grep -rln "OldName" src/` 找 caller
3. **改 DB schema**：照上面「DB 欄位 checklist」走
4. **加新測試**：在 `src/lib/__tests__/` 或 `src/app/api/*/`__tests__/` 加 case
5. **Push 後**：CI 會跑 build + 全套測試，紅燈會擋 merge
6. **Vercel preview**：PR 會自動部署一個 preview URL，可手動測試

---

## 🟡 想 debug 但不想動 production

### scripts/ 目錄全部是 read-only 診斷腳本

| 場景 | 跑哪個 |
|------|--------|
| 整套健康檢查 | `node scripts/diagnose-no-data.mjs` |
| 看 cron 哪天斷掉 | `node scripts/diagnose-cache.mjs` |
| 看 SerpApi 真實格式 | `node scripts/inspect-time-format.mjs` |
| 看單一航線報價 | `node scripts/inspect-jan30-feb4.mjs`（改裡面的 route/date） |
| 確認帳號額度 | 改一份 `inspect-account.mjs` 打 `https://serpapi.com/account` |

詳細用途看 `scripts/README.md`。

---

## 🟢 找不到問題對應這篇？

1. **看 `.claude/CLAUDE.md`** — 「踩過 / 別再踩」清單
2. **看 git log** — 之前有沒有人遇過類似的：
   ```bash
   git log --all --oneline | head -50
   ```
3. **看 search_runs / notifications 表** — 後端真實行為的證據
4. **看 Vercel Logs** — 後端 console.log / console.error 都在這
