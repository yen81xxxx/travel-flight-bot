/**
 * spot-check-intel.mjs — 跑 4 個範例給 user 看 priceIntel 判定合不合理
 *
 * 必要範例：
 *   1. 「建議入手」(buy) — 現在便宜、達標
 *   2. 「可考慮」(lean-buy) — 偏低但未達目標
 *   3. 「建議再等」(wait) — 現在偏高（**user 特別要求要有這個 case**）
 *   4. 「情報建立中」(building) — 歷史不到 14 天
 *
 * 跑法：node scripts/spot-check-intel.mjs
 * 用 tsx 是因為 priceIntel.ts 是 ts；但因為這支不在 lint scope 直接用 dist 不行，
 * 走 npx tsx 即可。
 */
import { computePriceIntel } from '../src/app/liff/_lib/priceIntel.ts';

const cases = [
  {
    title: '【範例 1】建議入手 (buy) — 已達標 + 偏低百分位',
    setup: '路線 TPE→NRT，目標 12000，歷史 16 天跌勢 14000→10500，當前 10500',
    history: [14000, 13800, 13500, 13200, 13000, 12800, 12500,
              12200, 12000, 11800, 11500, 11200, 11000, 10800,
              10600, 10500],
    currentBest: 10500,
    target: 12000,
    days: 60,
    deltaPct: -8
  },
  {
    title: '【範例 2】可考慮 (lean-buy) — 沒達標但低百分位',
    setup: '目標 12000，歷史 14 天跌勢 18000→13000，當前 13000 還沒達標',
    history: [18000, 17500, 17000, 16500, 16000, 15500, 15000,
              14500, 14000, 13800, 13500, 13300, 13100, 13000],
    currentBest: 13000,
    target: 12000,
    days: 60,
    deltaPct: -6
  },
  {
    title: '【⚠️ 範例 3】建議再等 (wait) — 高百分位（這個 case 必須要能觸發）',
    setup: '目標 14000，歷史 14 天在 11k–13k，當前 15000 高於歷史所有',
    history: [11000, 11500, 12000, 11800, 12200, 11600, 12500,
              12100, 11700, 12800, 12300, 11900, 12600, 12400],
    currentBest: 15000,
    target: 14000,
    days: 60,
    deltaPct: +5
  },
  {
    title: '【範例 4】情報建立中 (building) — 歷史只有 5 天',
    setup: '只追蹤 5 天的訂閱，引擎應該誠實說資料不夠、不給判斷',
    history: [12000, 11800, 12200, 11500, 11900],
    currentBest: 11900,
    target: 12000,
    days: 30,
    deltaPct: -1
  }
];

console.log('═'.repeat(70));
console.log('PR #5 Price Intelligence — Spot-check 4 verdict 範例');
console.log('═'.repeat(70));
console.log('');

for (const c of cases) {
  console.log(c.title);
  console.log(`  ${c.setup}`);
  const result = computePriceIntel(
    c.history.map((p, i) => ({ d: `t${i}`, p })),
    c.currentBest,
    c.target,
    c.days,
    c.deltaPct
  );

  if (result.status === 'building') {
    console.log(`  → status: building`);
    console.log(`  → tracked: ${result.tracked} / ${result.target}`);
    console.log(`  → remaining: ${result.remaining} 天`);
    console.log(`  → pct: ${result.pct}%`);
    console.log(`  → ⚠️ 沒有 verdict、沒有 headline (這就是 honesty gate)`);
  } else {
    console.log(`  → verdict: "${result.verdict}"`);
    console.log(`  → headline: "${result.headline}"`);
    console.log(`  → percentile: 第 ${result.percentile} 百分位`);
    console.log(`  → confidence: ${result.confidence}`);
    console.log(`  → hitTarget: ${result.hitTarget}`);
    console.log(`  → typical range: NT$${result.p25.toLocaleString()}–${result.p75.toLocaleString()}`);
    console.log(`  → reasons:`);
    for (const r of result.reasons) {
      console.log(`     • [${r.icon}] ${r.t}`);
    }
  }
  console.log('');
}

console.log('═'.repeat(70));
console.log('Sanity check：4 個 verdict 應該都不同（如果全是 "buy" 就是門檻寫反）');
console.log('═'.repeat(70));
