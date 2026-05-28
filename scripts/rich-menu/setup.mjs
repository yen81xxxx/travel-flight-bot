#!/usr/bin/env node
/**
 * Rich Menu 一鍵設置腳本
 *
 * 用法：
 *   1. 把 menu-image.svg 轉成 PNG（線上工具，2500×843，<1 MB），存成 menu-image.png
 *   2. 從專案根目錄跑：node scripts/rich-menu/setup.mjs
 *
 * 需要 env：LINE_CHANNEL_ACCESS_TOKEN（從 .env.local 自動讀）
 *
 * 流程：
 *   1. 創建 rich menu config（4 個按鈕 → message action 觸發 bot）
 *   2. 上傳 PNG 圖
 *   3. 設定為所有使用者的預設 rich menu
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGE_PATH = join(__dirname, 'menu-image.png');
const ROOT = join(__dirname, '..', '..');

// 從 .env.local 讀 token（若 env var 沒設）
function loadEnv() {
  const envPath = join(ROOT, '.env.local');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const m = t.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv();

const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
if (!token) {
  console.error('❌ 缺少 LINE_CHANNEL_ACCESS_TOKEN env var（在 .env.local 或 shell 設定）');
  process.exit(1);
}

if (!existsSync(IMAGE_PATH)) {
  console.error('❌ 找不到圖檔：' + IMAGE_PATH);
  console.error('   請先把 menu-image.svg 轉成 PNG（2500×843）放在同目錄叫 menu-image.png');
  process.exit(1);
}

// 4 個按鈕 → 每格 625 寬、全高 843
const richMenu = {
  size: { width: 2500, height: 843 },
  selected: true,
  name: 'Travel Flight Bot Main Menu',
  chatBarText: '🛫 開選單',
  areas: [
    {
      bounds: { x: 0,    y: 0, width: 625, height: 843 },
      action: { type: 'message', label: '查航班', text: '查航班' }
    },
    {
      bounds: { x: 625,  y: 0, width: 625, height: 843 },
      action: { type: 'message', label: '我的訂閱', text: '我的訂閱' }
    },
    {
      bounds: { x: 1250, y: 0, width: 625, height: 843 },
      action: { type: 'message', label: '設定', text: '設定' }
    },
    {
      bounds: { x: 1875, y: 0, width: 625, height: 843 },
      action: { type: 'message', label: '說明', text: '說明' }
    }
  ]
};

console.log('1️⃣  Creating rich menu config...');
const createResp = await fetch('https://api.line.me/v2/bot/richmenu', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(richMenu)
});
if (!createResp.ok) {
  console.error('❌ Create menu failed:', createResp.status, await createResp.text());
  process.exit(1);
}
const { richMenuId } = await createResp.json();
console.log('   ✓ Menu ID:', richMenuId);

console.log('2️⃣  Uploading image (' + IMAGE_PATH + ')...');
const imgBuffer = readFileSync(IMAGE_PATH);
const uploadResp = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'image/png' },
  body: imgBuffer
});
if (!uploadResp.ok) {
  console.error('❌ Image upload failed:', uploadResp.status, await uploadResp.text());
  process.exit(1);
}
console.log('   ✓ Image uploaded (' + (imgBuffer.length / 1024).toFixed(1) + ' KB)');

console.log('3️⃣  Setting as default rich menu for all users...');
const setDefaultResp = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` }
});
if (!setDefaultResp.ok) {
  console.error('❌ Set default failed:', setDefaultResp.status, await setDefaultResp.text());
  process.exit(1);
}
console.log('   ✓ Set as default');

console.log('\n✅ 完成！打開 LINE 跟 bot 對話應該會看到底部選單');
console.log('   Rich Menu ID:', richMenuId);
console.log('\n💡 之後想換圖：重跑這個 script 即可（會建新的覆蓋舊的）');
