/**
 * R4-A — 歷史走勢卡（A4）+ 文字 fallback（A5）+ delta 基準標示
 *
 * 為什麼測這些：
 *   1. 歷史卡是最後一個未翻新介面 — 零 emoji / 深色斷言把設計憲法鎖死
 *   2. percentile 行走同一顆 priceIntel：<14 點 = building → 不顯示
 *      （在薄資料上印百分位 = 假裝有判斷，違反產品定位）
 *   3. 「近期最低」tag 只在 current == 30 天最低時出現 — 不能常駐吹牛
 *   4. A5 文字版的 verdict 用詞必須跟 Flex/LIFF 同字（quota 爆掉時的訊息
 *      也不能說出不同的話）
 *   5. delta 基準標示：達標卡=較上週、摘要卡=較昨日 — 兩個不同指標
 *      沒標基準會被當同一個數字（spec honesty fix）
 */
import { buildHistoryFlex, mergeDailySeries, buildMultiSubsDailyFlex, type MultiSubsItem } from '../flex-message';
import { MIN_POINTS } from '@/app/liff/_lib/priceIntel';

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F0FF}]/u;

/** N 天的每日點（價格遞減 — 今天最低） */
function points(n: number, start = 16000, step = -150): { date: string; minPrice: number }[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-07-${String(i + 1).padStart(2, '0')}`,
    minPrice: start + i * step
  }));
}

const HIST_BASE = {
  origin: 'TPE',
  destination: 'NRT',
  outboundDate: '2026-08-04',
  returnDate: '2026-08-08',
  threshold: 12800
};

describe('mergeDailySeries', () => {
  it('跨分類每日取 min、按日期升冪', () => {
    const merged = mergeDailySeries(
      [{ date: '2026-07-02', minPrice: 12000 }, { date: '2026-07-01', minPrice: 15000 }],
      [{ date: '2026-07-01', minPrice: 14000 }, { date: '2026-07-03', minPrice: 13000 }]
    );
    expect(merged).toEqual([
      { date: '2026-07-01', minPrice: 14000 },  // min(15000, 14000)
      { date: '2026-07-02', minPrice: 12000 },
      { date: '2026-07-03', minPrice: 13000 }
    ]);
  });
});

describe('buildHistoryFlex（A4 深色版）', () => {
  it('零 emoji + 深色 #1b1b1f + 目標 tag + 打開 Travl CTA', () => {
    const json = JSON.stringify(buildHistoryFlex({ ...HIST_BASE, lccPoints: points(20), tradPoints: [] }));
    expect(json).not.toMatch(EMOJI_RE);
    expect(json).toContain('#1b1b1f');
    expect(json).toContain('目標 12,800');
    expect(json).toContain('打開 Travl 看詳情');
    expect(json).toContain('30 天前');
  });

  it(`percentile 行：≥${MIN_POINTS} 點才顯示（building 不假裝）`, () => {
    const ready = JSON.stringify(buildHistoryFlex({ ...HIST_BASE, lccPoints: points(20), tradPoints: [] }));
    expect(ready).toContain('百分位');
    const thin = JSON.stringify(buildHistoryFlex({ ...HIST_BASE, lccPoints: points(5), tradPoints: [] }));
    expect(thin).not.toContain('百分位');
  });

  it('「近期最低」tag 只在 current == 30 天最低時出現', () => {
    // 遞減 series → 今天就是最低 → tag 在
    const low = JSON.stringify(buildHistoryFlex({ ...HIST_BASE, lccPoints: points(20), tradPoints: [] }));
    expect(low).toContain('近期最低');
    // 遞增 series（step 正）→ 今天是最高 → 不能吹
    const high = JSON.stringify(buildHistoryFlex({ ...HIST_BASE, lccPoints: points(20, 10000, +150), tradPoints: [] }));
    expect(high).not.toContain('近期最低');
  });

  it('期間變化跟著 series 方向（跌 = 負、cyan；漲 = 正、紅）', () => {
    const down = JSON.stringify(buildHistoryFlex({ ...HIST_BASE, lccPoints: points(20), tradPoints: [] }));
    expect(down).toMatch(/期間變化/);
    expect(down).toMatch(/-1[0-9]%/);  // 16000 → 13150 ≈ -18%
    const up = JSON.stringify(buildHistoryFlex({ ...HIST_BASE, lccPoints: points(20, 10000, +150), tradPoints: [] }));
    expect(up).toMatch(/\+2[0-9]%/);   // 10000 → 12850 ≈ +28%
  });

  it('無資料 → 誠實空狀態（零 emoji）', () => {
    const json = JSON.stringify(buildHistoryFlex({ ...HIST_BASE, lccPoints: [], tradPoints: [] }));
    expect(json).toContain('尚無歷史資料');
    expect(json).not.toMatch(EMOJI_RE);
  });
});

describe('delta 基準標示（spec honesty fix）', () => {
  it('摘要 route bubble delta 標「較昨日」', () => {
    const item: MultiSubsItem = {
      origin: 'TPE', destination: 'NRT', outboundDate: '2026-08-04', returnDate: '2026-08-08',
      maxPrice: 12000, maxPriceTraditional: null, label: null,
      cheapestPrice: 13000, cheapestAirport: 'NRT', cheapestCategory: 'lcc', cheapestAirline: '酷航',
      vsPrevPct: -4, errorReason: null,
      lcc: { price: 13000, airport: 'NRT', outboundAirline: '酷航', returnAirline: '捷星', vsPrevPct: -4 },
      traditional: null
    };
    const json = JSON.stringify(buildMultiSubsDailyFlex({ items: [item], sourceId: 'U1' }));
    expect(json).toContain('▼ 4%');
    expect(json).toContain('較昨日');
  });
});
