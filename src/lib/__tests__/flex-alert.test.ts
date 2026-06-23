/**
 * L1 — 個人價格達標 Flex 卡（深色版）+ push-intel parity
 *
 * 為什麼測這些（intent，不只 behavior）：
 *   1. 零 emoji 是設計憲法（LINE_SURFACE_SPEC §E）— regex 掃整包 JSON
 *   2. verdict badge 文案必須跟 LIFF VERDICT_META 一字不差 — 推播說「建議入手」
 *      而 app 說「可考慮」= 信任產品死掉（spec §E 第一條 parity）
 *   3. intel 不足（building / 撈不到）不出 badge — 不能在薄資料上假裝有判斷
 *   4. CTA 排序是產品決議：看走勢與航班（留在 Travl）永遠在 Skyscanner 上面
 */
import { buildAlertFlex, buildTopAirlinesBox, deriveCarrierDisplay, VERDICT_FLEX_META } from '../flex-message';
import { buildGroupAlertFlex } from '../group-flex';
import { buildPushIntel } from '../push-intel';
import { VERDICT_META, MIN_POINTS, type Verdict } from '@/app/liff/_lib/priceIntel';

/** emoji 偵測 — 涵蓋常用 emoji blocks（符號箭頭 ▼▲ 不算 emoji，允許） */
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{1F000}-\u{1F0FF}]/u;

const BASE_PROPS = {
  origin: 'TPE',
  destination: 'NRT',
  outboundDate: '2026-08-04',
  returnDate: '2026-08-08',
  cheapestPrice: 11480,
  threshold: 12800,
  airline: '酷航',
  sourceId: 'Uabc123'
};

const FULL_PROPS = {
  ...BASE_PROPS,
  verdict: 'buy' as Verdict,
  carrier: { tag: 'lcc' as const, line: '酷航 → 捷星' }
};

describe('buildAlertFlex（L1 深色版）', () => {
  it('整包 JSON 零 emoji（含 altText）', () => {
    const json = JSON.stringify(buildAlertFlex(FULL_PROPS));
    expect(json).not.toMatch(EMOJI_RE);
  });

  it('深色卡：body #1b1b1f、舊橘色 #ff7a45 已絕跡', () => {
    const json = JSON.stringify(buildAlertFlex(FULL_PROPS));
    expect(json).toContain('#1b1b1f');
    expect(json).not.toContain('#ff7a45');
  });

  it('verdict=buy → header 有「建議入手」badge；verdict 缺 → 無 badge（薄資料不假裝）', () => {
    const withVerdict = JSON.stringify(buildAlertFlex(FULL_PROPS));
    expect(withVerdict).toContain('建議入手');

    const noVerdict = JSON.stringify(buildAlertFlex(BASE_PROPS));
    expect(noVerdict).not.toContain('建議入手');
    expect(noVerdict).not.toContain('觀察中');
  });

  it('topAirlines → 顯示前 3 家（廉/傳 tag + 各自價格），取代單一 carrier 行', () => {
    const json = JSON.stringify(buildAlertFlex({
      ...FULL_PROPS,
      topAirlines: [
        { airline: '捷星', price: 6077 },
        { airline: '酷航', price: 6540 },
        { airline: '星宇航空', price: 7880 }
      ]
    }));
    expect(json).toContain('捷星');
    expect(json).toContain('NT$6,077');
    expect(json).toContain('星宇航空');
    expect(json).toContain('NT$7,880');
    expect(json).toContain('廉航');   // 捷星/酷航
    expect(json).toContain('傳統');   // 星宇航空
  });

  it('topAirlines 空 → 退回單一 carrier 行（舊行為，不顯示「便宜航空」清單）', () => {
    const json = JSON.stringify(buildAlertFlex({ ...FULL_PROPS, topAirlines: [] }));
    expect(json).not.toContain('便宜航空');
    expect(json).toContain('酷航 → 捷星');  // carrier.line 還在
  });

  it('buildTopAirlinesBox 空/undefined → null（caller fallback）', () => {
    expect(buildTopAirlinesBox([])).toBeNull();
    expect(buildTopAirlinesBox(undefined)).toBeNull();
  });

  it('CTA 排序：看走勢與航班（primary）在 Skyscanner（link ghost）前面', () => {
    const flex = buildAlertFlex(FULL_PROPS) as {
      contents: { footer: { contents: { style: string; action: { label: string } }[] } };
    };
    const btns = flex.contents.footer.contents;
    expect(btns[0].action.label).toBe('看走勢與航班');
    expect(btns[0].style).toBe('primary');
    expect(btns[1].action.label).toBe('用 Skyscanner 訂');
    expect(btns[1].style).toBe('link');
  });

  it('卡片已拿掉漲跌幅 + 走勢條圖（簡化）', () => {
    const json = JSON.stringify(buildAlertFlex(FULL_PROPS));
    expect(json).not.toContain('較上週');
    expect(json).not.toContain('▼');
    expect(json).not.toContain('▲');
  });

  it('目標差距併進價格列：一般 →「（比目標低 NT$X）」；<1% 邊界 →「（達到目標價）」', () => {
    // 降幅 <1%（只差 NT$8）→ 不寫「低 NT$8」像 bug，改「達到目標價」
    const atThreshold = JSON.stringify(buildAlertFlex({ ...BASE_PROPS, cheapestPrice: 12792 }));
    expect(atThreshold).toContain('（達到目標價）');
    expect(atThreshold).not.toContain('比目標低');
    // 一般降幅 → 「比目標低 NT$1,320」（12800 - 11480）
    const normal = JSON.stringify(buildAlertFlex(BASE_PROPS));
    expect(normal).toContain('（比目標低 NT$1,320）');
    // 舊的獨立「跌破目標價」box 已移除
    expect(normal).not.toContain('已跌破你的目標價');
  });

  it('altText 無 emoji 且帶 IATA 路線 + verdict', () => {
    const flex = buildAlertFlex(FULL_PROPS) as { altText: string };
    expect(flex.altText).toBe('價格達標：TPE → NRT NT$11,480（建議入手）');
  });

  it('verdict 徽章移到路線標題那一行（不再有獨立 header bar）', () => {
    const flex = buildAlertFlex(FULL_PROPS) as {
      contents: { header?: unknown; body: { contents: { layout?: string }[] } };
    };
    expect(flex.contents.header).toBeUndefined();  // header bar 已拿掉
    const firstRow = flex.contents.body.contents[0];
    expect(firstRow.layout).toBe('horizontal');     // 路線那行是水平排版
    const rowJson = JSON.stringify(firstRow);
    expect(rowJson).toContain('東京');              // 路線（NRT = 東京）
    expect(rowJson).toContain('建議入手');          // verdict 徽章同一行
  });

  it('無 verdict → 路線行只有路線、無徽章（薄資料不假裝）', () => {
    const flex = buildAlertFlex(BASE_PROPS) as {
      contents: { body: { contents: { contents?: unknown[] }[] } };
    };
    const firstRow = flex.contents.body.contents[0];
    expect(JSON.stringify(firstRow)).not.toContain('建議入手');
  });
});

describe('VERDICT_FLEX_META ↔ LIFF VERDICT_META parity', () => {
  it('四種 verdict 的中文 label 一字不差（推播跟 app 永不打架）', () => {
    (Object.keys(VERDICT_META) as Verdict[]).forEach(v => {
      expect(VERDICT_FLEX_META[v].label).toBe(VERDICT_META[v].label);
    });
  });
});

describe('deriveCarrierDisplay', () => {
  it('LCC 較便宜 → lcc tag + 去回組合；同家去回 → 單名', () => {
    expect(deriveCarrierDisplay(
      { outboundAirline: '酷航', returnAirline: '捷星', price: 10000 },
      { airline: '長榮', price: 15000 },
      '酷航'
    )).toEqual({ tag: 'lcc', line: '酷航 → 捷星' });

    expect(deriveCarrierDisplay(
      { outboundAirline: '酷航', returnAirline: '酷航', price: 10000 },
      null,
      null
    )).toEqual({ tag: 'lcc', line: '酷航' });
  });

  it('傳統較便宜 → trad tag + 同家來回；同價 → 優先 LCC（同 quote-builder 規則）', () => {
    expect(deriveCarrierDisplay(
      { outboundAirline: '酷航', returnAirline: '捷星', price: 16000 },
      { airline: '星宇', price: 15000 },
      null
    )).toEqual({ tag: 'trad', line: '星宇・同家來回' });

    expect(deriveCarrierDisplay(
      { outboundAirline: '酷航', returnAirline: '捷星', price: 15000 },
      { airline: '星宇', price: 15000 },
      null
    )!.tag).toBe('lcc');
  });

  it('兩類都沒有 → fallback airline；全空 → null', () => {
    expect(deriveCarrierDisplay(null, null, '長榮')).toEqual({ tag: null, line: '長榮' });
    expect(deriveCarrierDisplay(null, null, null)).toBeNull();
  });
});

describe('buildGroupAlertFlex verdict parity（L1）', () => {
  const GROUP_PROPS = {
    origin: 'TPE',
    destination: 'KIX',
    outboundDate: '2026-09-01',
    returnDate: '2026-09-05',
    cheapestPrice: 9800,
    threshold: 11000,
    airline: '台灣虎航',
    groupId: 'Cgroup1',
    subscriptionId: 7,
    memberCount: 4,
    topMemberNames: ['Alice', 'Bob', 'Carol']
  };

  it('verdict=buy → header badge 建議入手；不帶 verdict → 無 badge', () => {
    const withV = JSON.stringify(buildGroupAlertFlex({ ...GROUP_PROPS, verdict: 'buy' }));
    expect(withV).toContain('建議入手');
    const noV = JSON.stringify(buildGroupAlertFlex(GROUP_PROPS));
    expect(noV).not.toContain('建議入手');
  });

  it('群組卡也是深色 body + 零 emoji', () => {
    const json = JSON.stringify(buildGroupAlertFlex({ ...GROUP_PROPS, verdict: 'buy' }));
    expect(json).toContain('#1b1b1f');
    expect(json).not.toMatch(EMOJI_RE);
  });
});

describe('buildPushIntel（推播當下的 intel — 同 LIFF 引擎）', () => {
  /** 製造 N 天的 rows，每天兩筆（取 min 的邏輯也順便蓋到） */
  function makeRows(days: number, base = 12000): { queried_at: string; price: number | null }[] {
    const rows: { queried_at: string; price: number | null }[] = [];
    for (let i = 0; i < days; i++) {
      const d = String(i + 1).padStart(2, '0');
      rows.push({ queried_at: `2026-07-${d}T03:00:00Z`, price: base + i * 10 });
      rows.push({ queried_at: `2026-07-${d}T15:00:00Z`, price: base + i * 10 + 500 });
    }
    return rows;
  }

  it(`history < ${MIN_POINTS} 天 → status building（不給 verdict — 誠實 gate）`, () => {
    const r = buildPushIntel(makeRows(5), [], 11000, 12000, '2026-08-04');
    expect(r.intel?.status).toBe('building');
  });

  it(`history ≥ ${MIN_POINTS} 天 + 價格達標 → ready 且 hitTarget verdict=buy`, () => {
    const r = buildPushIntel(makeRows(20), [], 11000, 12000, '2026-08-04');
    expect(r.intel?.status).toBe('ready');
    if (r.intel?.status === 'ready') {
      expect(r.intel.verdict).toBe('buy');
      expect(r.intel.hitTarget).toBe(true);
    }
  });

  it('每日取 min（兩筆裡較低那筆）+ dailyMins 升冪日期', () => {
    const r = buildPushIntel(makeRows(15, 10000), [], 9000, 12000, null);
    expect(r.dailyMins[0]).toBe(10000);   // day1 min（10000 vs 10500）
    expect(r.dailyMins[14]).toBe(10140);  // day15 min
  });

  it('weekAgo rows → deltaPct = (now-weekMin)/weekMin；無資料 → null', () => {
    const r = buildPushIntel(makeRows(15), [{ price: 12000 }, { price: 11000 }], 10450, 13000, null);
    expect(r.deltaPct).toBe(-5);  // (10450-11000)/11000 = -5%
    const r2 = buildPushIntel(makeRows(15), [], 10450, 13000, null);
    expect(r2.deltaPct).toBeNull();
  });
});
