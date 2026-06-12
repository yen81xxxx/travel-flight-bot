# Rich Menu 設置（L3 — 2×3 深色版）

LINE bot 底部固定選單，照 `LINE_SURFACE_SPEC` §B：

| | | |
|---|---|---|
| 查航班（藍） | **新增追蹤（綠 featured）** | 我的訂閱（青） |
| 今日機票（橘） | 群組追蹤（紫） | 通知設定（灰） |

全部格子開 LIFF deep link（`?action=add` / `?action=settings` / `?filter=hit` / `?filter=group`），
WatchlistView 已支援這些參數。**靜態版 v1** — 不做 live 數字 badge（spec 建議；數字在 LIFF 內看）。

## 流程

1. **SVG → PNG**（離線、不用線上工具）
   ```bash
   node scripts/rich-menu/render-png.mjs
   ```
   產出 `menu-image.png`（2500×1686，需 < 1 MB）。
   **轉完務必目視檢查**：中文沒變豆腐、版面沒跑位。

2. **Dry-run 驗證**（不打 LINE API）
   ```bash
   node scripts/rich-menu/setup.mjs --dry-run
   ```

3. **⛔ 真上傳**（全用戶立即生效 — 先取得核可再跑）
   ```bash
   node scripts/rich-menu/setup.mjs
   ```

需要 env（自動讀 `.env.local`）：`LINE_CHANNEL_ACCESS_TOKEN`、`NEXT_PUBLIC_LIFF_ID`。

## 想換圖 / 改按鈕

- 改 `menu-image.svg` → 重跑 render-png → 重跑 setup（會建新 menu 覆蓋舊的）
- 改按鈕動作：編輯 `setup.mjs` 裡 `richMenu.areas`

## 移除 Rich Menu

```bash
curl -X DELETE 'https://api.line.me/v2/bot/user/all/richmenu' \
  -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN"
```
