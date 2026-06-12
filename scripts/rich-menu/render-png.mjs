#!/usr/bin/env node
/**
 * menu-image.svg → menu-image.png（2500×1686，LINE Rich Menu 規格）
 *
 * 用 sharp（devDependency）離線轉檔 — 不再依賴線上工具。
 *   node scripts/rich-menu/render-png.mjs
 *
 * 注意：SVG 內中文字靠系統字型（Microsoft JhengHei / PingFang TC）。
 * 轉完務必打開 PNG 目視檢查：文字沒變豆腐、版面沒跑位。
 */
import { statSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SVG = join(__dirname, 'menu-image.svg');
const PNG = join(__dirname, 'menu-image.png');

const png = await sharp(SVG, { density: 72 })
  .resize(2500, 1686)
  .png({ compressionLevel: 9 })
  .toFile(PNG);

const kb = statSync(PNG).size / 1024;
console.log(`✓ ${PNG}`);
console.log(`  ${png.width}×${png.height}, ${kb.toFixed(1)} KB ${kb < 1024 ? '(< 1 MB ✓)' : '⚠️ 超過 LINE 1 MB 上限！'}`);
