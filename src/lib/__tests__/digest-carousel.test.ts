/**
 * L2 — 每日摘要 carousel（LINE_SURFACE_SPEC §A1）
 *
 * 為什麼測這些：
 *   1. **每筆訂閱都要出一張卡**（user 鐵則：訂閱幾筆就全顯示，不藏沒達標/沒變動的）。
 *      只排序（達標排前），不過濾 — 漏掉任何一筆 = 違反鐵則
 *   2. isItemHit 的 per-category 目標語意（lcc←maxPrice /
 *      trad←maxPriceTraditional??maxPrice）拿錯會虛報達標
 *   3. carousel ≤ 12 bubbles（lead + cap 11）— LINE 上限 12，超過整則被拒；
 *      被截要 fail loud（lead 標明只顯示前 N 條）
 *   4. 配額暫滿不能無聲消失（fail loud）— lead bubble 必須帶橘字
 *   5. 零 emoji（設計憲法）
 */
import {
  buildMultiSubsDailyFlex,
  isItemHit,
  bestDelta,
  orderRoutesForDigest,
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

describe('bestDelta / orderRoutesForDigest', () => {
  it('取絕對值最大的 delta（跨 item 層級 + 兩分類）', () => {
    expect(bestDelta(makeItem({ vsPrevPct: -2, lcc: { price: 1, airport: 'NRT', outboundAirline: 'a', returnAirline: 'b', vsPrevPct: 5 } }))).toBe(5);
    expect(bestDelta(makeItem())).toBeNull();
  });

  it('不過濾 — 全部都留；達標排前、再按 |Δ| 降冪、安靜的排最後', () => {
    const hit = makeItem({ cheapestPrice: 11000, lcc: { price: 11000, airport: 'NRT', outboundAirline: 'a', returnAirline: 'b', vsPrevPct: null } });
    const bigMove = makeItem({ vsPrevPct: -4 });
    const smallMove = makeItem({ vsPrevPct: -1 });
    const quiet = makeItem();
    const ordered = orderRoutesForDigest([smallMove, bigMove, quiet, hit]);
    // 一個都不能少（鐵則：訂閱幾筆就全顯示）
    expect(ordered).toHaveLength(4);
    expect(ordered[0]).toBe(hit);       // 達標排第一
    expect(ordered[1]).toBe(bigMove);   // 再來大變動
    expect(ordered).toContain(smallMove);
    expect(ordered).toContain(quiet);   // 安靜的也在（沒被丟掉）
  });
});

describe('buildMultiSubsDailyFlex（carousel 結構）', () => {
  type Carousel = { altText: string; contents: { type: string; contents: Record<string, unknown>[] } };

  it('每筆訂閱都出卡（安靜的也在）— lead + 3 routes，達標排前', () => {
    const flex = buildMultiSubsDailyFlex({
      items: [
        makeItem({ cheapestPrice: 11000, lcc: { price: 11000, airport: 'NRT', outboundAirline: '酷航', returnAirline: '捷星', vsPrevPct: -6.2 } }),
        makeItem(), // 安靜 — 也要出卡（不再被藏）
        makeItem({ vsPrevPct: 4 })
      ],
      sourceId: 'Uabc'
    }) as Carousel;
    expect(flex.contents.type).toBe('carousel');
    expect(flex.contents.contents).toHaveLength(4); // lead + 全部 3 條
    expect(flex.altText).toBe('今日機票摘要：1 條已達標，最低 NT$11,000');
  });

  it('20 條 → cap：1 lead + 11 routes = 12 bubbles（= LINE 上限）+ lead 標明被截', () => {
    const items = Array.from({ length: 20 }, (_, i) => makeItem({ vsPrevPct: 5 + i }));
    const flex = buildMultiSubsDailyFlex({ items, sourceId: 'U1' }) as Carousel;
    expect(flex.contents.contents).toHaveLength(12);
    // fail loud：少了 9 條要講出來
    expect(JSON.stringify(flex)).toContain('只顯示前 11 條（共 20 條）');
  });

  it('沒有任何達標 → 每條仍出卡、文案請往右滑看現價', () => {
    const flex = buildMultiSubsDailyFlex({ items: [makeItem(), makeItem()], sourceId: 'U1' }) as Carousel;
    expect(flex.contents.contents).toHaveLength(3); // lead + 全部 2 條（不再縮成單張 lead）
    const json = JSON.stringify(flex);
    expect(json).toContain('往右滑看每條現價');
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
    // 動作鈕：淡藍底（#0a84ff26）+ link 樣式藍字（不再是整塊亮藍實心 primary）
    expect(json).toContain('#0a84ff26');
    expect(json).toContain('"style":"link"');
    expect(json).not.toContain('"style":"primary"');
  });

  it('route bubble：達標→已達標綠 header；未達標→監控中；目標只寫一次、不再有大標題省X文案', () => {
    const flex = buildMultiSubsDailyFlex({
      items: [
        makeItem({ cheapestPrice: 11000, lcc: { price: 11000, airport: 'NRT', outboundAirline: '酷航', returnAirline: '捷星', vsPrevPct: null } }),
        makeItem({ vsPrevPct: 4 })  // 13000 > 12000 未達標
      ],
      sourceId: 'U1'
    });
    const json = JSON.stringify(flex);
    expect(json).toContain('已達標');
    expect(json).toContain('監控中');
    expect(json).toContain('目標 NT$12,000');   // 目標寫在日期列、只寫一次
    expect(json).not.toContain('低於目標');       // 舊的大標題「省 X」那套移除
    expect(json).not.toContain('還差');
  });

  it('route bubble：比照警報卡列前 3 家航空 + 各自價（topAirlines）', () => {
    const flex = buildMultiSubsDailyFlex({
      items: [makeItem({
        cheapestPrice: 8000,
        lcc: { price: 8000, airport: 'NRT', outboundAirline: '樂桃', returnAirline: '樂桃', vsPrevPct: null },
        topAirlines: [
          { airline: '樂桃', price: 8000, depTime: '09:10', arrTime: '13:20', dropVsPrev: 538 },  // 比昨天便宜 538
          { airline: '酷航', price: 9000, depTime: '14:05', arrTime: '18:10' },                     // 沒便宜 → 不標 ↘
          { airline: '捷星', price: 10000 }  // 缺時間 → 該列只出航司+價、不爆
        ]
      })],
      sourceId: 'U1'
    });
    const json = JSON.stringify(flex);
    // 三家航司 + 各自價都要出現在卡片裡（不再只顯示一個最低價）
    expect(json).toContain('樂桃');
    expect(json).toContain('NT$8,000');
    expect(json).toContain('酷航');
    expect(json).toContain('NT$9,000');
    expect(json).toContain('捷星');
    expect(json).toContain('NT$10,000');
    // 出發→抵達 時間（有資料的那兩家）
    expect(json).toContain('09:10→13:20');
    expect(json).toContain('14:05→18:10');
    // 比昨天便宜 → 綠色 ↘NT$跌幅（只標便宜的那家）
    expect(json).toContain('↘NT$538');
    expect((json.match(/↘NT\$/g) || []).length).toBe(1);  // 只有樂桃一家標
  });

  it('route bubble：沒有 topAirlines → 不畫前 3 家那塊（降級不爆）', () => {
    const flex = buildMultiSubsDailyFlex({
      items: [makeItem({ cheapestPrice: 11000, lcc: { price: 11000, airport: 'NRT', outboundAirline: '酷航', returnAirline: '捷星', vsPrevPct: null } })],
      sourceId: 'U1'
    });
    // topAirlines undefined → buildTopAirlinesBox 回 null，卡片照常 render（有價格、達標文案）
    const json = JSON.stringify(flex);
    expect(json).toContain('NT$11,000');
  });
});

describe('buildRouteBubble — 開口式來回（0015，multi-city 一張票）', () => {
  const ojItem = (over: Partial<MultiSubsItem> = {}): MultiSubsItem => makeItem({
    origin: 'TPE', destination: 'NRT', outboundDate: '2027-01-29', returnDate: '2027-02-05',
    maxPrice: 20000, maxPriceTraditional: null,
    cheapestPrice: 18683, cheapestCategory: null, cheapestAirline: '中華航空', cheapestAirport: null,
    lcc: null, traditional: null, vsPrevPct: null,
    openJaw: {
      out: { origin: 'TPE', destination: 'NRT', date: '2027-01-29', time: '15:20' },
      back: { origin: 'HND', destination: 'TSA', date: '2027-02-05', time: '12:15' },
      airline: '中華航空'
    },
    ...over
  });

  it('isItemHit：整程總價 ≤ 目標 → 達標；> 目標 → 不達標', () => {
    expect(isItemHit(ojItem())).toBe(true);                          // 18683 ≤ 20000
    expect(isItemHit(ojItem({ cheapestPrice: 21000 }))).toBe(false); // 21000 > 20000
  });

  it('卡片畫兩段路線 + 一張票總價 + 開口式 pill + 多城市航司 + 達標文案', () => {
    const flex = buildMultiSubsDailyFlex({ items: [ojItem()], sourceId: 'U1' });
    const json = JSON.stringify(flex);
    expect(json).toContain('異地來回');             // 開口式 tag 改白話
    expect(json).toContain('HND');                  // 回段出發
    expect(json).toContain('TSA');                  // 回段抵達
    expect(json).toContain('1/29 15:20');           // 去程日期＋釘選時間
    expect(json).toContain('2/5 12:15');            // 回程日期＋釘選時間
    expect(json).toContain('一張票');
    expect(json).toContain('18,683');               // 整程總價
    expect(json).toContain('多城市單一票・中華航空 起');
    expect(json).toContain('低於目標 NT$20,000（省 NT$1,317）');
  });

  it('查無多城市票（總價 null）→ 仍出卡並誠實標「查無」（鐵則：訂閱就顯示，不藏）', () => {
    const flex = buildMultiSubsDailyFlex({ items: [ojItem({ cheapestPrice: null })], sourceId: 'U1' }) as { contents: { contents: unknown[] } };
    expect(flex.contents.contents).toHaveLength(2);  // lead + 該路線（不再藏）
    expect(JSON.stringify(flex)).toContain('此條件查無多城市票');
  });
});
