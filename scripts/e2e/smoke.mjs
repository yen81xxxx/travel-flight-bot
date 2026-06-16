#!/usr/bin/env node
/**
 * E2E 煙霧測試 harness — 黑箱打真正的 API，自己驗、自己清。
 *
 * 為什麼存在：jest 單測只驗純函數；很多 bug 只在「真的端到端跑一遍 + 比對
 * 資料庫」才現形（例：Supabase stale-read 快取，刪除後 with-quotes 還回舊值 —
 * 單測抓不到，只有實際打 API 才抓得到）。這支把那種手動操控固化成可重複跑的工具。
 *
 * 用法：
 *   node scripts/e2e/smoke.mjs                  # 打 .env.local 的 NEXT_PUBLIC_APP_URL（prod）
 *   node scripts/e2e/smoke.mjs --base=http://localhost:3000   # 打本地 next start
 *   npm run e2e
 *
 * 需要 .env.local：NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY（驗 DB + 清資料）。
 *
 * 安全保證：
 *   - 所有測試資料用 Ue2e_/Ce2e_ 前綴 + 本次 run id，跟真實資料完全隔離
 *   - 只建「遠未來日期 + 超高目標價」訂閱 → 即使 cron 跑也不會誤觸發 alert
 *   - **不碰** cron / 航班搜尋（不燒 SerpApi）、不送真 LINE 推播
 *   - finally 一定 hard-delete 本次所有測試資料（連跑失敗也清）
 *
 * 退出碼：全過 0、有 fail 1（可接 CI / pre-deploy gate，但因需 service-role key
 * 預設不掛在 GitHub Actions）。
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// ---- env ----
// .env.local 找得到就讀（正常 `npm run e2e` 時 cwd = repo root 就有）。
// 多候選位置：cwd、script 所在 repo root。worktree 開發時 .env.local 可能在主 repo。
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
for (const dir of [process.cwd(), ROOT]) {
  const p = join(dir, '.env.local');
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.trim().match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
  break;
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('✗ 缺 .env.local（需 NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY）。從 repo 根目錄跑 npm run e2e。');
  process.exit(2);
}

// BASE 預設打 prod（.env.local 的 NEXT_PUBLIC_APP_URL 通常是 dev localhost，不適合當預設）。
// 本地測試用 --base=http://localhost:3000。
const PROD_URL = 'https://travel-flight-bot.vercel.app';
const baseArg = process.argv.find(a => a.startsWith('--base='));
const BASE = (baseArg ? baseArg.slice(7) : (process.env.E2E_BASE_URL || PROD_URL)).replace(/\/$/, '');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ---- run-scoped test ids（跟真實資料隔離 + 清理用）----
const RUN = Date.now().toString(36);
const sid = (kind) => `${kind}e2e_${RUN}_${Math.random().toString(36).slice(2, 8)}`;
const sourceIds = new Set();   // 要清的 source_id
const subIds = new Set();      // 要清的 subscription_id（清群組子表用）
const U = () => { const s = sid('U'); sourceIds.add(s); return s; };
const C = () => { const s = sid('C'); sourceIds.add(s); return s; };
const trackSub = (id) => { if (id != null) subIds.add(id); return id; };

// ---- 迷你測試框架 ----
let pass = 0, fail = 0; const failures = [];
const section = (t) => console.log(`\n── ${t} ──`);
const check = (cond, msg) => {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; failures.push(msg); console.log('  ✗ FAIL: ' + msg); }
};

// ---- 斷言引擎自我檢驗（守門員的守門員）----
// 用「真正的 check()」跑一真一假，確認 pass/fail 計數器真的會分別 +1。
// 若有人把 check() 改壞（例：fail 不計數 → 整套永遠綠燈給假安心），這裡會抓到並中止。
// 跑完歸零，不污染真正的測試計數。
(function selfTest() {
  check(true, '__selftest_should_pass');
  check(false, '__selftest_should_fail');
  if (pass !== 1 || fail !== 1) {
    console.error(`✗ 斷言引擎自我檢驗失敗（pass=${pass} fail=${fail}，預期 1/1）— check() 被改壞了，整套測試不可信，中止。`);
    process.exit(3);
  }
  pass = 0; fail = 0; failures.length = 0;
  console.log('✓ 斷言引擎自我檢驗通過（check() 會正確區分真/假）');
})();

// ---- API helpers ----
const J = async (r) => { const t = await r.text(); let body; try { body = JSON.parse(t); } catch { body = t; } return { status: r.status, body, headers: r.headers }; };
const api = {
  get: (p) => fetch(BASE + p).then(J),
  post: (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(J),
  patch: (p, b) => fetch(BASE + p, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(J),
  del: (p) => fetch(BASE + p, { method: 'DELETE' }).then(J)
};
// 遠未來 + 超高價：cron 即使跑也不會誤觸發
const FAR_OUT = '2027-12-01', FAR_RET = '2027-12-08', SAFE_PRICE = 999999;

async function run() {
  // ============================================================
  section('A. 個人訂閱生命週期');
  const u = U();
  let r = await api.post('/api/subscriptions', { sourceId: u, origin: 'TPE', destination: 'NRT', maxPrice: SAFE_PRICE, outboundDate: FAR_OUT, returnDate: FAR_RET });
  check(r.status === 200 && r.body.action === 'created', 'POST 建立 → created');
  const id = trackSub(r.body.subscription?.id);
  check(id != null, '回 subscription.id');

  r = await api.post('/api/subscriptions', { sourceId: u, origin: 'TPE', destination: 'NRT', maxPrice: SAFE_PRICE - 1, outboundDate: FAR_OUT, returnDate: FAR_RET });
  check(r.body.action === 'updated' && r.body.id === id, '同條再 POST → updated 同 id（dedup）');

  r = await api.get('/api/subscriptions?sourceId=' + u);
  check(r.body.ok && r.body.subscriptions?.length === 1, 'GET list → 1 筆');

  r = await api.get('/api/subscriptions/with-quotes?sourceId=' + u);
  check(r.body.ok && r.body.watches?.length === 1 && 'quote' in r.body.watches[0], 'with-quotes → 1 watch（含 quote 欄位）');

  r = await api.patch('/api/subscriptions', { id, sourceId: u, maxPrice: 123456 });
  check(r.status === 200 && r.body.ok, 'PATCH maxPrice → ok');
  let db = (await sb.from('subscriptions').select('max_price').eq('id', id).single()).data;
  check(Number(db?.max_price) === 123456, 'DB max_price 真的改成 123456');

  r = await api.patch('/api/subscriptions', { id, sourceId: 'Uwrong_' + RUN, maxPrice: 1 });
  check(r.status === 404, 'PATCH 錯 sourceId → 404（不假成功）');
  db = (await sb.from('subscriptions').select('max_price').eq('id', id).single()).data;
  check(Number(db?.max_price) === 123456, 'DB 沒被錯誤 PATCH 改到');

  r = await api.del(`/api/subscriptions?id=${id}&sourceId=${u}`);
  check(r.status === 200 && r.body.ok, 'DELETE → ok');
  db = (await sb.from('subscriptions').select('active').eq('id', id).single()).data;
  check(db?.active === false, 'DB active=false（軟刪）');

  r = await api.del(`/api/subscriptions?id=${id}&sourceId=${u}`);
  check(r.status === 200 && r.body.ok, 'DELETE 重複 → ok（冪等）');

  r = await api.del(`/api/subscriptions?id=999999999&sourceId=${u}`);
  check(r.status === 404, 'DELETE 不存在 id → 404');

  // ============================================================
  section('B. 快取一致性回歸（抓到過的 stale-read bug — 永久守門）');
  // warm with-quotes → delete → 立刻重讀必須為空（不能回快取舊值）
  const u2 = U();
  r = await api.post('/api/subscriptions', { sourceId: u2, origin: 'TPE', destination: 'KIX', maxPrice: SAFE_PRICE, outboundDate: FAR_OUT, returnDate: FAR_RET });
  const id2 = trackSub(r.body.subscription?.id);
  await api.get('/api/subscriptions/with-quotes?sourceId=' + u2);  // WARM cache
  await api.del(`/api/subscriptions?id=${id2}&sourceId=${u2}`);
  r = await api.get('/api/subscriptions/with-quotes?sourceId=' + u2);
  check(r.body.watches?.length === 0, 'warm→刪除→重讀 = 0 筆（無 stale read）');

  // warm → patch → 重讀必須反映新值
  const u3 = U();
  r = await api.post('/api/subscriptions', { sourceId: u3, origin: 'KHH', destination: 'NRT', maxPrice: SAFE_PRICE, outboundDate: FAR_OUT, returnDate: FAR_RET });
  const id3 = trackSub(r.body.subscription?.id);
  await api.get('/api/subscriptions/with-quotes?sourceId=' + u3);  // WARM
  await api.patch('/api/subscriptions', { id: id3, sourceId: u3, maxPrice: 222333 });
  r = await api.get('/api/subscriptions/with-quotes?sourceId=' + u3);
  check(Number(r.body.watches?.[0]?.max_price) === 222333, 'warm→改價→重讀反映新值（無 stale read）');

  // ============================================================
  section('C. 群組：入會 / 共識 / 投票');
  const g = C(), a = U(), b = U();
  r = await api.post('/api/subscriptions', { sourceId: g, origin: 'TPE', destination: 'NRT', maxPrice: 20000, outboundDate: '2027-11-01', returnDate: '2027-11-08', creatorUserId: a, creatorDisplayName: 'Alice' });
  const gid = trackSub(r.body.subscription?.id);
  check(r.body.subscription?.source_type === 'group', '建立群組訂閱');
  r = await api.get('/api/group-watch/' + gid);
  check(r.body.members?.length === 1 && Number(r.body.derivedTarget) === 20000, '建立者自動入會 + derived=20000');

  r = await api.post('/api/group-watch/' + gid, { action: 'join', userId: b, displayName: 'Bob' });
  check(r.body.action === 'joined', 'B join');
  r = await api.post('/api/group-watch/' + gid, { action: 'join', userId: b });
  check(r.body.ok, 'B 重複 join → 冪等');
  r = await api.post('/api/group-watch/' + gid, { action: 'set-target', userId: 'Unon_' + RUN, target: 5000 });
  check(r.status === 403, '非 member set-target → 403');
  r = await api.post('/api/group-watch/' + gid, { action: 'set-target', userId: b, target: 15000 });
  check(Number(r.body.derivedTarget) === 20000, 'B 設 15000 → derived 仍 20000（max 規則）');
  r = await api.post('/api/group-watch/' + gid, { action: 'set-target', userId: a, target: 12000 });
  check(Number(r.body.derivedTarget) === 15000, 'A 改 12000 → derived=15000');
  db = (await sb.from('subscriptions').select('max_price').eq('id', gid).single()).data;
  check(Number(db?.max_price) === 15000, 'subscriptions.max_price 同步 derived');

  r = await api.post('/api/group-watch/' + gid + '/poll', { action: 'add-option', userId: a, outDate: '2027-11-01', retDate: '2027-11-08' });
  const opt1 = r.body.optionId;
  check(opt1 != null, 'add-option 1');
  r = await api.post('/api/group-watch/' + gid + '/poll', { action: 'add-option', userId: b, outDate: '2027-11-15', retDate: '2027-11-22' });
  const opt2 = r.body.optionId;
  check(opt2 && opt2 !== opt1, 'add-option 2（不同 id）');
  r = await api.post('/api/group-watch/' + gid + '/poll', { action: 'add-option', userId: a, outDate: '2027-11-01', retDate: '2027-11-08' });
  check(r.body.optionId === opt1, '重複加同日期 → 回同 id（去重）');
  await api.post('/api/group-watch/' + gid + '/poll', { action: 'vote', userId: a, optionId: opt1 });
  await api.post('/api/group-watch/' + gid + '/poll', { action: 'vote', userId: b, optionId: opt1 });
  r = await api.get('/api/group-watch/' + gid + '/poll?userId=' + a);
  check(r.body.options?.find(o => o.id === opt1)?.voteCount === 2, 'opt1 2 票');
  check(r.body.myVote === opt1, 'A myVote=opt1');
  await api.post('/api/group-watch/' + gid + '/poll', { action: 'vote', userId: a, optionId: opt2 });  // 換票
  r = await api.get('/api/group-watch/' + gid + '/poll?userId=' + a);
  check(r.body.options?.find(o => o.id === opt1)?.voteCount === 1, '換票後 opt1 剩 1');
  r = await api.post('/api/group-watch/' + gid + '/poll', { action: 'vote', userId: a, optionId: 999999999 });
  check(r.status === 400, '投跨 sub / 不存在 option → 400');
  r = await api.post('/api/group-watch/' + gid + '/poll', { action: 'remove-option', userId: a, optionId: opt2 });
  check(r.body.ok, 'remove-option');
  r = await api.post('/api/group-watch/' + gid, { action: 'leave', userId: b });
  check(r.body.action === 'left', 'B leave');

  // ============================================================
  section('D. 邊界資料');
  const u4 = U();
  r = await api.post('/api/subscriptions', { sourceId: u4, origin: 'TPE', destination: 'NRT', maxPrice: 30000, outboundDate: '2027-10-01' });
  const id4 = trackSub(r.body.subscription?.id);
  db = (await sb.from('subscriptions').select('return_date').eq('id', id4).single()).data;
  check(db?.return_date === null, '單程訂閱 return_date=null');
  r = await api.patch('/api/subscriptions', { id: id4, sourceId: u4, maxPriceTraditional: 25000 });
  db = (await sb.from('subscriptions').select('max_price_traditional').eq('id', id4).single()).data;
  check(Number(db?.max_price_traditional) === 25000, '傳統另設目標 25000');
  r = await api.patch('/api/subscriptions', { id: id4, sourceId: u4, maxPriceTraditional: null });
  db = (await sb.from('subscriptions').select('max_price_traditional').eq('id', id4).single()).data;
  check(db?.max_price_traditional === null, 'maxPriceTraditional=null 清掉（跟隨主目標）');
  r = await api.patch('/api/subscriptions', { id: id4, sourceId: u4, returnDate: '2027-10-08' });
  db = (await sb.from('subscriptions').select('return_date').eq('id', id4).single()).data;
  check(db?.return_date === '2027-10-08', '單程補 returnDate → 變來回');

  // ============================================================
  section('E. 驗證 / 設定 / 量測');
  r = await api.post('/api/subscriptions', { sourceId: U(), origin: 'TPE', destination: 'NRT', maxPrice: 0, outboundDate: FAR_OUT });
  check(r.status === 400, 'maxPrice=0 → 400');
  r = await api.post('/api/subscriptions', { sourceId: U(), origin: 'TPE', destination: 'TSA', maxPrice: 10000, outboundDate: FAR_OUT });
  check(r.status === 400, '台灣→台灣 → 400（refine）');
  const u5 = U();
  r = await api.patch('/api/subscriptions', { id: 1, sourceId: u5 });
  check(r.status === 400, 'PATCH 無欄位 → 400');

  // #6 局部更新不洗值（注意 DB 存 'HH:MM:SS'）
  await api.post('/api/notification-settings', { sourceId: u5, quietStart: '22:00', quietEnd: '08:00', timezone: 'Asia/Taipei' });
  r = await api.post('/api/notification-settings', { sourceId: u5, dailySummary: false });
  check(r.body.ok, '只改 dailySummary → ok');
  r = await api.get('/api/notification-settings?sourceId=' + u5);
  check(/^22:00(:00)?$/.test(r.body.settings?.quiet_start || '') && /^08:00(:00)?$/.test(r.body.settings?.quiet_end || ''), '靜音時段沒被洗掉（#6）');
  check(r.body.settings?.daily_summary === false, 'dailySummary 有更新');
  r = await api.get('/api/notification-settings?sourceId=Unone_' + RUN);
  check(r.body.ok && r.body.settings === null, '不存在 source → settings:null');
  r = await api.get('/api/notification-settings');
  check(r.status === 400, '缺 sourceId → 400');

  r = await api.post('/api/track', { src: 'evil-injection', userId: U() });
  check(r.status === 400, 'track src 白名單外 → 400');
  r = await api.post('/api/track', { src: 'group-alert', ctx: C(), userId: U() });
  check(r.status === 200, 'track 合法 src → 200（表存在則記錄、不存在則 no-op）');
}

async function cleanup() {
  const srcs = [...sourceIds];
  const ids = [...subIds];
  const safe = async (fn, label) => { try { await fn(); } catch (e) { console.warn(`  ⚠ cleanup ${label}:`, e.message); } };
  if (ids.length) {
    await safe(() => sb.from('date_vote').delete().in('subscription_id', ids), 'date_vote');
    await safe(() => sb.from('date_option').delete().in('subscription_id', ids), 'date_option');
    await safe(() => sb.from('group_member').delete().in('subscription_id', ids), 'group_member');
  }
  if (srcs.length) {
    await safe(() => sb.from('subscriptions').delete().in('source_id', srcs), 'subscriptions');
    await safe(() => sb.from('notification_settings').delete().in('source_id', srcs), 'notification_settings');
    await safe(() => sb.from('click_event').delete().in('line_user_id', srcs), 'click_event'); // 表可能不存在
  }
}

console.log(`E2E smoke → ${BASE}  (run ${RUN})`);
let exitCode = 0;
try {
  await run();
} catch (e) {
  fail++; failures.push('harness threw: ' + e.message);
  console.error('\n✗ harness 例外:', e);
} finally {
  await cleanup();
  console.log('\n── 清理 ──\n  已 hard-delete 本次測試資料');
  console.log(`\n=== ${pass} pass / ${fail} fail ===`);
  if (failures.length) { console.log('失敗項目：'); failures.forEach(f => console.log('  - ' + f)); exitCode = 1; }
  else console.log('✅ 全部通過');
}
process.exit(exitCode);
