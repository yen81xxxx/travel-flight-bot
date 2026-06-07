# scripts/

一次性 Node.js 診斷工具。所有 script 用 `node scripts/<name>.mjs` 跑，
讀 `.env.local` 取 `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
/ `SERPAPI_KEY` 等變數。

> 跑之前確認 `.env.local` 有實際值（worktree 內可能是空的，用主 repo 的）。

## 對 Supabase 資料庫的查詢

### `diagnose-no-data.mjs`
**用途**：使用者抱怨「LINE 卡片顯示查無資料」時，第一個跑這個。
列出所有 active 訂閱、對應 flight_quotes 的最新樣本、本月 SerpApi 用量、
最近 5 次 cron 結果。

### `diagnose-cache.mjs`
**用途**：判斷 cron 哪天斷掉。對指定路線列出每天 cron 寫入的 quote 數
（按時間 batch 分組）。找「斷層」用。

### `inspect-time-format.mjs`
**用途**：驗證 SerpApi raw 的 `departure_airport.time` 真實格式。抽 50
筆樣本確認格式 `'YYYY-MM-DD HH:MM'` 跟 `extractDepartureHHMM` 的 regex 一致。
改時段過濾邏輯時值得重跑。

### `inspect-baggage.mjs`
**用途**：確認 SerpApi raw 有沒有行李資訊。**結論已知：沒有**。保留腳本
供之後 SerpApi 規格改變時重驗。

### `inspect-eva-quotes.mjs`
**用途**：針對 TPE→HND 2027-01-30 路線列出長榮報價細節（含 raw 多 leg
資訊）。debug 長榮報價怪異時用。

### `inspect-jan30-feb4.mjs`
**用途**：對 TPE↔NRT 1/30→2/4 路線列出 LCC / Traditional 的最低報價，
按 trip_leg 分類顯示。debug 某條訂閱該如何訂時用。

### `inspect-star-price.mjs`
**用途**：列出星宇 / 捷星近期報價的方向 + trip_leg + 配對精確度。
debug 「星宇怎麼比廉航便宜？」這種異常時用。

## 對 SerpApi 的測試

### `probe-serpapi.mjs`
**用途**：直打 SerpApi 看實際 HTTP 狀態與錯誤訊息。
**注意**：會用掉 1〜3 個 SerpApi 配額。只在 cron 持續失敗、需要區分
「系統 bug vs 配額 vs 路線無資料」時跑。

## 其他

### `rich-menu/`
LINE Bot Rich Menu 設定腳本（一次性，setup 時跑）。
含 `setup.mjs` / `menu-image.svg` / `README.md`。

---

## 寫新 script 的約定

1. 放在 `scripts/` 下、檔名要描述用途（`diagnose-*` / `inspect-*` /
   `probe-*` 之類前綴）
2. 標頭 comment 寫：用途 / 何時用 / 副作用（會用配額嗎、會寫 DB 嗎）
3. 用 `import { readFileSync } from 'fs'` 讀 `.env.local`，**不要** import
   專案內的 src/* code（避免 ES module / Next.js runtime 衝突）
4. 跑完更新這個 README 的清單
