# Rich Menu 設置

LINE bot 底部固定 4 顆按鈕：🔍 查航班 / 📋 我的訂閱 / ⚙️ 設定 / ℹ️ 說明

## 第一次設置

1. **把 SVG 轉成 PNG**
   - 打開 `menu-image.svg`（瀏覽器或預覽工具看設計）
   - 用線上轉換器轉成 PNG，**尺寸必須 2500×843，大小 < 1 MB**
   - 推薦工具：https://cloudconvert.com/svg-to-png
   - 轉出來存成 `menu-image.png` 放這個資料夾

2. **執行 setup**
   ```bash
   node scripts/rich-menu/setup.mjs
   ```

3. **確認**
   打開 LINE 跟 bot 聊天，底部應該會出現 4 顆按鈕選單

## 想換圖 / 改按鈕

- 改 SVG → 重轉 PNG → 重跑 `setup.mjs`（會新建 menu 覆蓋舊的）
- 改按鈕動作：編輯 `setup.mjs` 裡 `richMenu.areas` 陣列

## 移除 Rich Menu

```bash
curl -X DELETE 'https://api.line.me/v2/bot/user/all/richmenu' \
  -H "Authorization: Bearer $LINE_CHANNEL_ACCESS_TOKEN"
```
