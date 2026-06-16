# E2E 煙霧測試（自動化操控）

黑箱打**真正的 API**、自己驗、自己清的端到端煙霧測試。補 jest 單測抓不到的整合 bug
——例如 Supabase stale-read 快取（刪除後 with-quotes 還回舊值，單測抓不到，只有實際
打 API + 比對 DB 才現形）。

## 跑

```bash
npm run e2e                                  # 預設打 prod
node scripts/e2e/smoke.mjs --base=http://localhost:3000   # 打本地 next start
E2E_BASE_URL=https://xxx npm run e2e         # 自訂目標
```

需要 `.env.local`（repo 根目錄）：`NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
（驗 DB 狀態 + 清理測試資料用）。全過退出碼 0、有 fail 1。

## 涵蓋

| 區 | 內容 |
|----|------|
| A 個人生命週期 | 建立 / dedup / 查 / with-quotes / PATCH（+錯 source→404）/ DELETE（+冪等 +不存在→404）|
| **B 快取回歸** | **warm→刪除→重讀=空、warm→改價→重讀=新值**（抓到過的 stale-read bug 永久守門）|
| C 群組 | 自動入會 / join 冪等 / set-target 權限 / 共識 max / DB 同步 / 投票 / 換票 / 跨 sub 防呆 / 移除 / 離開 |
| D 邊界 | 單程 / 傳統另設目標 / 清 null / 單程→來回 |
| E 驗證設定 | maxPrice=0 / 台日驗證 / 空 PATCH / 設定局部更新不洗值 / 空 GET / track 白名單 |

## 安全

- 測試資料一律 `Ue2e_` / `Ce2e_` 前綴 + run id，跟真實資料完全隔離
- 只建「遠未來日期 + 超高目標價」訂閱 → 即使 cron 跑也不會誤觸發 alert
- **不碰** cron / 航班搜尋（不燒 SerpApi 配額）、不送真 LINE 推播
- `finally` 一定 hard-delete 本次所有測試資料（連跑失敗也清）

## 為什麼不掛 CI

需要 service-role key 才能驗 DB + 清資料，不適合放進 GitHub Actions（密鑰 + 會打到 prod）。
這是**手動 / 部署前**的煙霧工具。部署完跑一次 `npm run e2e` 確認線上沒壞。
