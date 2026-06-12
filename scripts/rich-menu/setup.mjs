#!/usr/bin/env node
/**
 * Rich Menu 一鍵設置腳本 — L3 2×3 深色版（LINE_SURFACE_SPEC §B）
 *
 * 用法：
 *   node scripts/rich-menu/render-png.mjs          # SVG → PNG（先轉圖）
 *   node scripts/rich-menu/setup.mjs --dry-run     # 只驗證 config + 圖檔，不打 LINE API
 *   node scripts/rich-menu/setup.mjs               # ⛔ 真上傳（全用戶立即生效）— 需 user 核可
 *
 * 需要 env：LINE_CHANNEL_ACCESS_TOKEN、NEXT_PUBLIC_LIFF_ID（從 .env.local 自動讀）
 *
 * 流程：create config → upload PNG → set default for all users
 * 所有格子都開 LIFF（deep link 參數 WatchlistView 已支援）：
 *   ?action=add / ?action=settings / ?filter=hit / ?filter=group
 */

import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGE_PATH = join(__dirname, 'menu-image.png');
const ROOT = join(__dirname, '..', '..');
const DRY_RUN = process.argv.includes('--dry-run');

// 從 .env.local 讀 env（若 shell 沒設）
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
const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://travel-flight-bot.vercel.app';

// LIFF deep link — 同 group-flex buildLiffUrl 的模式（liff.line.me 會把 query 帶進 app）
function liffUrl(qs = '') {
  return liffId
    ? `https://liff.line.me/${liffId}${qs}`
    : `${appUrl}/liff${qs}`;
}

// 2×3 grid：2500×1686，每格 ~833×843
const COL = [0, 833, 1666];
const COL_W = [833, 833, 834];
const ROW = [0, 843];
const ROW_H = 843;

const richMenu = {
  size: { width: 2500, height: 1686 },
  selected: true,
  name: 'Travl Rich Menu v2 (dark 2x3)',
  chatBarText: 'Travl 選單',
  areas: [
    // Row 1
    {
      bounds: { x: COL[0], y: ROW[0], width: COL_W[0], height: ROW_H },
      action: { type: 'uri', label: '查航班', uri: liffUrl('?action=add') }
    },
    {
      bounds: { x: COL[1], y: ROW[0], width: COL_W[1], height: ROW_H },
      action: { type: 'uri', label: '新增追蹤', uri: liffUrl('?action=add') }
    },
    {
      bounds: { x: COL[2], y: ROW[0], width: COL_W[2], height: ROW_H },
      action: { type: 'uri', label: '我的訂閱', uri: liffUrl() }
    },
    // Row 2
    {
      bounds: { x: COL[0], y: ROW[1], width: COL_W[0], height: ROW_H },
      action: { type: 'uri', label: '今日機票', uri: liffUrl('?filter=hit') }
    },
    {
      bounds: { x: COL[1], y: ROW[1], width: COL_W[1], height: ROW_H },
      action: { type: 'uri', label: '群組追蹤', uri: liffUrl('?filter=group') }
    },
    {
      bounds: { x: COL[2], y: ROW[1], width: COL_W[2], height: ROW_H },
      action: { type: 'uri', label: '通知設定', uri: liffUrl('?action=settings') }
    }
  ]
};

// ===== 驗證（dry-run 也跑） =====
if (!existsSync(IMAGE_PATH)) {
  console.error('❌ 找不到圖檔：' + IMAGE_PATH);
  console.error('   先跑：node scripts/rich-menu/render-png.mjs');
  process.exit(1);
}
const imgBuffer = readFileSync(IMAGE_PATH);
if (imgBuffer.length > 1024 * 1024) {
  console.error(`❌ 圖檔 ${(imgBuffer.length / 1024).toFixed(0)} KB 超過 LINE 1 MB 上限`);
  process.exit(1);
}
if (!liffId) {
  console.warn('⚠️ NEXT_PUBLIC_LIFF_ID 未設 — areas 會用 fallback 網址（非 LIFF 開啟，少登入態）');
}

if (DRY_RUN) {
  console.log('🔍 dry-run — 不打 LINE API\n');
  console.log('圖檔:', IMAGE_PATH, `(${(imgBuffer.length / 1024).toFixed(1)} KB)`);
  console.log('\nRich menu config:');
  console.log(JSON.stringify(richMenu, null, 2));
  console.log('\n✓ 驗證通過。真上傳請去掉 --dry-run（⛔ 全用戶立即生效，先取得核可）');
  process.exit(0);
}

if (!token) {
  console.error('❌ 缺少 LINE_CHANNEL_ACCESS_TOKEN env var（在 .env.local 或 shell 設定）');
  process.exit(1);
}

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

console.log('\n✅ 完成！打開 LINE 跟 bot 對話應該會看到新的 2×3 深色選單');
console.log('   Rich Menu ID:', richMenuId);
console.log('\n💡 之後想換圖：改 SVG → render-png → 重跑這個 script（會建新的覆蓋舊的）');
