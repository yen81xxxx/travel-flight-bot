/**
 * L2 — 每日摘要 carousel（LINE_SURFACE_SPEC §A1）
 *
 * 為什麼測這些：
 *   1. 「值得看」過濾是本次改版的核心 — 舊版傾倒全部訂閱，新版只放
 *      達標 + 明顯變動。過濾錯 = 又回到 spam（或漏掉達標的 — 更糟）
 *   2. isItemHit 的 per-category 目標語意（lcc←maxPrice /
 *      trad←maxPriceTraditional??maxPrice）拿錯會虛報達標
 *   3. carousel ≤ 10 bubbles（lead + cap 9）— LINE 上限 12，超過整則被拒
 *   4. 配額暫滿不能無聲消失（fail loud）— lead bubble 必須帶橘字
 *   5. 零 emoji（設計憲法）
 */
import {
  buildMultiSubsDailyFlex,
  isItemHit,
  bestDelta,
  pickNoteworthy,
  NOTEWORTHY_DELTA_PCT,
  type MultiSubsItem
} from '../flex-message';

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F0FF}]/u;

/** 最小可用 item — 預設未達標、無變動 */
function makeItem(over: Partial<MultiSubsItem> = {}): MultiSubsItem {
  return {
    origin: 'TPE',
    destination: 'NRT',
    outboundDate: '2026-08-04',
    returnDate: '2026-08-08',
    maxPrice: 12000,
    maxPriceTraditional: null,
    label: null,
    cheapestPrice: 13000,
    cheapestAirport: 'NRT',
    cheapestCategory: 'lcc',
    cheapestAirline: '酷航',
    vsPrevPct: null,
    errorReason: null,
    lcc: { price: 13000, airport: 'NRT', outboundAirline: '酷航', returnAirline: '捷星', vsPrevPct: null },
    traditional: null,
    ...over
  };
}

describe('isItemHit（per-category 目標語意）', () => {
  it('lcc 跌破 maxPrice → hit；trad 比 maxPriceTraditional 才算', () => {
    expect(isItemHit(makeItem({ lcc: { price: 11000, airport: 'NRT', outboundAirline: '酷航', returnAirline: '捷星', vsPrevPct: null } }))).toBe(true);
    // trad 12500 > maxPrice 12000 但 ≤ maxPriceTraditional 13000 → hit（別用錯目標）
    expect(isItemHit(makeItem({
      lcc: null,
      maxPriceTraditional: 13000,
      traditional: { price: 12500, airport: 'NRT', airline: '星宇', vsPrevPct: null }
    }))).toBe(true);
    // maxPriceTraditional 未設 → fallback maxPrice → 12500 > 12000 不算
    expect(isItemHit(makeItem({
      lcc: null,
      traditional: { price: 12500, airport: 'NRT', airline: '星宇', vsPrevPct: null }
    }))).toBe(false);
  });

  it('無任何報價 → 不是 hit', () => {
    expect(isItemHit(makeItem({ lcc: null, traditional: null, cheapestPrice: null }))).toBe(false);
  });
});

describe('bestDelta / pickNoteworthy', () => {
  it('取絕對值最大的 delta（跨 item 層級 + 兩分類）', () => {
    expect(bestDelta(makeItem({ vsPrevPct: -2, lcc: { price: 1, airport: 'NRT', outboundAirline: 'a', returnAirline: 'b', vsPrevPct: 5 } }))).toBe(5);
    expect(bestDelta(makeItem())).toBeNull();
  });

  it(`達標 or |Δ| ≥ ${NOTEWORTHY_DELTA_PCT}% 才入選；達標排前、再按 |Δ| 降冪`, () => {
    const hit = makeItem({ cheapestPrice: 11000, lcc: { price: 11000, airport: 'NRT', outboundAirline: 'a', returnAirline: 'b', vsPrevPct: null } });
    const bigMove = makeItem({ vsPrevPct: -4 });
    const smallMove = makeItem({ vsPrevPct: -1 });
    const quiet = makeItem();
    const picked = pickNoteworthy([smallMove, bigMove, quiet, hit]);
    expect(picked).toHaveLength(2);
    expect(picked[0]).toBe(hit);
    expect(picked[1]).toBe(bigMove);
  });
});

describe('buildMultiSubsDailyFlex（carousel 結構）', () => {
  type Carousel = { altText: string; contents: { type: string; contents: Record<string, unknown>[] } };

  it('lead + 只放 noteworthy；安靜路線不佔 bubble', () => {
    const flex = buildMultiSubsDailyFlex({
      items: [
        makeItem({ cheapestPrice: 11000, lcc: { price: 11000, airport: 'NRT', outboundAirline: '酷航', returnAirline: '捷星', vsPrevPct: -6.2 } }),
        makeItem(), // 安靜 — 不該出現
        makeItem({ vsPrevPct: 4 })
      ],
      sourceId: 'Uabc'
    }) as Carousel;
    expect(flex.contents.type).toBe('carousel');
    expect(flex.contents.contents).toHaveLength(3); // lead + hit + bigMove
    expect(flex.altText).toBe('今日機票摘要：1 條已達標，最低 NT$11,000');
  });

  it('20 條全 noteworthy → cap：1 lead + 9 routes = 10 bubbles（< LINE 上限 12）', () => {
    const items = Array.from({ length: 20 }, (_, i) => makeItem({ vsPrevPct: 5 + i }));
    const flex = buildMultiSubsDailyFlex({ items, sourceId: 'U1' }) as Carousel;
    expect(flex.contents.contents).toHaveLength(10);
  });

  it('沒有任何 noteworthy → 單張 lead、文案誠實說沒變化', () => {
    const flex = buildMultiSubsDailyFlex({ items: [makeItem(), makeItem()], sourceId: 'U1' }) as Carousel;
    expect(flex.contents.contents).toHaveLength(1);
    const json = JSON.stringify(flex);
    expect(json).toContain('都沒有大變化');
    expect(flex.altText).toContain('今天沒有航線跌破目標價');
  });

  it('配額暫滿 → lead 帶橘色提示（fail loud，不無聲消失）', () => {
    const flex = buildMultiSubsDailyFlex({
      items: [makeItem({ cheapestPrice: null, lcc: null, errorReason: 'quota-exhausted' })],
      sourceId: 'U1'
    });
    const json = JSON.stringify(flex);
    expect(json).toContain('查詢額度暫滿');
    expect(json).toContain('#ff9f0a');
  });

  it('整包 JSON 零 emoji + 深色 #1b1b1f + 打開 Travl CTA', () => {
    const flex = buildMultiSubsDailyFlex({
      items: [makeItem({ cheapestPrice: 11000, lcc: { price: 11000, airport: 'NRT', outboundAirline: '酷航', returnAirline: '捷星', vsPrevPct: -6.2 } })],
      sourceId: 'Uabc',
      cachedAt: '2026-06-12T00:30:00Z'
    });
    const json = JSON.stringify(flex);
    expect(json).not.toMatch(EMOJI_RE);
    expect(json).toContain('#1b1b1f');
    expect(json).toContain('打開 Travl 看全部');
  });

  it('route bubble：達標 → 已達標綠 header + 低於目標文案；未達標變動 → 監控中 + 還差', () => {
    const flex = buildMultiSubsDailyFlex({
      items: [
        makeItem({ cheapestPrice: 11000, lcc: { price: 11000, airport: 'NRT', outboundAirline: '酷航', returnAirline: '捷星', vsPrevPct: null } }),
        makeItem({ vsPrevPct: 4 })  // 13000 > 12000 未達標
      ],
      sourceId: 'U1'
    });
    const json = JSON.stringify(flex);
    expect(json).toContain('已達標');
    expect(json).toContain('低於目標 NT$12,000（省 NT$1,000）');
    expect(json).toContain('監控中');
    expect(json).toContain('目標 NT$12,000・還差 NT$1,000');
  });
});
