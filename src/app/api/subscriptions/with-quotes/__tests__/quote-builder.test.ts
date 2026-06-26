/**
 * buildWatchQuote — 純函數測試
 *
 * 5 分支：
 *   1. 全機場都沒料 → null
 *   2. 只有 LCC（傳統沒匹配）
 *   3. 只有傳統
 *   4. 兩者都有，LCC 較便宜（currentType='lcc'）
 *   5. 兩者都有，傳統較便宜（currentType='trad'）
 *
 * 降級分支：
 *   - deltaPct: weekAgoMin=null → null；weekAgoMin<=0 → null
 *   - history: daily=[] → []
 *   - currentType 同價時優先 lcc（手冊默認）
 *
 * Helpers (formatShortDate, dailyToHistory, computeDeltaPct) 也獨立測。
 */
import {
  buildWatchQuote,
  buildOpenJawWatchQuote,
  formatShortDate,
  dailyToHistory,
  computeDeltaPct,
  computeDaysUntil,
  type QuoteSourceData,
  type OpenJawQuoteSource
} from '../quote-builder';
import type { Subscription, FlightQuote } from '@/types';
import { MIN_POINTS } from '@/app/liff/_lib/priceIntel';

// === fixtures ===
const baseSub: Subscription = {
  id: 1,
  source_id: 'Uabc',
  source_type: 'user',
  origin: 'TPE',
  destination: 'NRT',
  outbound_date: '2026-08-14',
  return_date: '2026-08-18',
  max_price: 12800,
  max_price_traditional: 24000,
  active: true,
  paused: false,
  currency: 'TWD',
  label: null,
  outbound_min_departure_time: null,
  outbound_max_departure_time: null,
  return_min_departure_time: null,
  return_max_departure_time: null
};

/** 偽造一筆 FlightQuote — 只填影響 analyzeFlights 的欄位 */
const mkQuote = (overrides: Partial<FlightQuote>): FlightQuote => ({
  origin: 'TPE',
  destination: 'NRT',
  outbound_date: '2026-08-14',
  return_date: '2026-08-18',
  airline: '酷航',
  airline_code: 'TR',
  price: 11000,
  currency: 'TWD',
  duration_minutes: 180,
  stops: 0,
  flight_type: 'best',
  trip_leg: 'outbound',
  ...overrides
});

const emptySrc = (): QuoteSourceData => ({
  recentByAirport: new Map(),
  weekAgoMin: null,
  daily: []
});

describe('formatShortDate', () => {
  it('正常 YYYY-MM-DD → M/D', () => {
    expect(formatShortDate('2026-06-08')).toBe('6/8');
    expect(formatShortDate('2026-12-31')).toBe('12/31');
  });

  it('壞資料 → 不 throw，原樣回（讓資料污染先被看到，後處理）', () => {
    expect(formatShortDate('garbage')).toBe('garbage');
    expect(formatShortDate('')).toBe('');
  });

  it('不受時區影響（純字串切，不用 Date）', () => {
    // UTC+8 跑時 new Date('2026-06-08') 會在某些時區變 6/7 — 我們要 6/8 不管在哪
    expect(formatShortDate('2026-06-08')).toBe('6/8');
  });
});

describe('dailyToHistory', () => {
  it('轉換每筆 + 順序保留', () => {
    expect(dailyToHistory([
      { date: '2026-06-08', minPrice: 12000 },
      { date: '2026-06-09', minPrice: 11500 }
    ])).toEqual([
      { d: '6/8', p: 12000 },
      { d: '6/9', p: 11500 }
    ]);
  });

  it('空 array → 空 array', () => {
    expect(dailyToHistory([])).toEqual([]);
  });
});

describe('computeDeltaPct', () => {
  it('便宜了 6.2% → -6.2', () => {
    // weekAgo=12000, current=11256 → (11256-12000)/12000 = -0.062 → -6.2
    expect(computeDeltaPct(11256, 12000)).toBe(-6.2);
  });

  it('漲了 → 正數', () => {
    expect(computeDeltaPct(12600, 12000)).toBe(5);
  });

  it('沒變 → 0', () => {
    expect(computeDeltaPct(12000, 12000)).toBe(0);
  });

  it('weekAgoMin == null → null（前端藏 delta chip）', () => {
    expect(computeDeltaPct(11000, null)).toBeNull();
  });

  it('weekAgoMin <= 0（壞資料）→ null，不要除零', () => {
    expect(computeDeltaPct(11000, 0)).toBeNull();
    expect(computeDeltaPct(11000, -100)).toBeNull();
  });

  it('四捨五入到 1 位小數', () => {
    // 11999/12000 - 1 = -0.0000833... × 100 = -0.0083% → -0.0
    expect(computeDeltaPct(11999, 12000)).toBe(-0);
    // 11800/12000 - 1 = -0.01666... × 100 = -1.6666 → -1.7
    expect(computeDeltaPct(11800, 12000)).toBe(-1.7);
  });
});

describe('buildWatchQuote — 4 主分支', () => {
  it('1) 沒任何 fanout 機場資料 → null', () => {
    expect(buildWatchQuote(baseSub, emptySrc())).toBeNull();
  });

  it('1b) fanout 有機場但裡面航班都空 → null', () => {
    const src = emptySrc();
    src.recentByAirport.set('NRT', { outbound: [], return: [] });
    expect(buildWatchQuote(baseSub, src)).toBeNull();
  });

  it('2) 只有 LCC（沒傳統航空在 list 中）→ currentType=lcc, trad=null', () => {
    const src = emptySrc();
    src.recentByAirport.set('NRT', {
      outbound: [mkQuote({ airline: '酷航', price: 11000, trip_leg: 'outbound' })],
      return: [mkQuote({ airline: '酷航', price: 11200, trip_leg: 'return' })]
    });
    const q = buildWatchQuote(baseSub, src);
    expect(q).not.toBeNull();
    expect(q!.currentType).toBe('lcc');
    expect(q!.lcc).not.toBeNull();
    expect(q!.trad).toBeNull();
  });

  it('3) 只有傳統 → currentType=trad', () => {
    const src = emptySrc();
    src.recentByAirport.set('NRT', {
      outbound: [
        mkQuote({ airline: '星宇航空', airline_code: 'JX', price: 18000, trip_leg: 'outbound' })
      ],
      return: []  // 沒 return 才會 fallback 到「同家來回估算」(traditionalRoundTrip)
    });
    const q = buildWatchQuote(baseSub, src);
    expect(q).not.toBeNull();
    expect(q!.currentType).toBe('trad');
    expect(q!.trad?.airline).toBe('星宇航空');
    expect(q!.lcc).toBeNull();
  });

  it('4) 兩者都有 + LCC 便宜 → currentType=lcc', () => {
    const src = emptySrc();
    src.recentByAirport.set('NRT', {
      outbound: [
        mkQuote({ airline: '酷航', price: 11000, trip_leg: 'outbound' }),
        mkQuote({ airline: '星宇航空', airline_code: 'JX', price: 18000, trip_leg: 'outbound' })
      ],
      return: [
        mkQuote({ airline: '酷航', price: 11200, trip_leg: 'return' })
      ]
    });
    const q = buildWatchQuote(baseSub, src);
    expect(q!.currentType).toBe('lcc');
    expect(q!.currentBest).toBe(11200);
  });

  it('5) 兩者都有 + 傳統便宜 → currentType=trad', () => {
    const src = emptySrc();
    src.recentByAirport.set('NRT', {
      outbound: [
        mkQuote({ airline: '酷航', price: 20000, trip_leg: 'outbound' }),
        mkQuote({ airline: '星宇航空', airline_code: 'JX', price: 15000, trip_leg: 'outbound' })
      ],
      return: [
        mkQuote({ airline: '酷航', price: 21000, trip_leg: 'return' })
      ]
    });
    const q = buildWatchQuote(baseSub, src);
    expect(q!.currentType).toBe('trad');
    expect(q!.currentBest).toBe(15000);
  });
});

describe('buildWatchQuote — 跨機場挑最便宜 (fanout)', () => {
  it('東京 HND + NRT，NRT 比 HND 便宜 → 拿 NRT', () => {
    const src = emptySrc();
    src.recentByAirport.set('HND', {
      outbound: [mkQuote({ airline: '酷航', destination: 'HND', price: 13000, trip_leg: 'outbound' })],
      return: [mkQuote({ airline: '酷航', destination: 'HND', price: 13500, trip_leg: 'return' })]
    });
    src.recentByAirport.set('NRT', {
      outbound: [mkQuote({ airline: '酷航', destination: 'NRT', price: 11000, trip_leg: 'outbound' })],
      return: [mkQuote({ airline: '酷航', destination: 'NRT', price: 11200, trip_leg: 'return' })]
    });
    const q = buildWatchQuote(baseSub, src);
    // analyzeFlights 對 LCC 用 cheapestRet — NRT=11200 vs HND=13500 → 應該拿 NRT 11200
    expect(q!.currentBest).toBe(11200);
  });
});

describe('buildWatchQuote — 降級欄位', () => {
  it('沒 weekAgoMin → deltaPct=null（quote 仍然出）', () => {
    const src = emptySrc();
    src.recentByAirport.set('NRT', {
      outbound: [mkQuote({ airline: '酷航', price: 11000 })],
      return: [mkQuote({ airline: '酷航', price: 11200, trip_leg: 'return' })]
    });
    const q = buildWatchQuote(baseSub, src);
    expect(q!.deltaPct).toBeNull();
  });

  it('有 weekAgoMin → 算 deltaPct', () => {
    const src = emptySrc();
    src.recentByAirport.set('NRT', {
      outbound: [mkQuote({ airline: '酷航', price: 11000 })],
      return: [mkQuote({ airline: '酷航', price: 11200, trip_leg: 'return' })]
    });
    src.weekAgoMin = 12000;
    const q = buildWatchQuote(baseSub, src);
    // (11200 - 12000) / 12000 * 100 = -6.67 → -6.7
    expect(q!.deltaPct).toBe(-6.7);
  });

  it('沒 daily history → history=[]（quote 仍然出）', () => {
    const src = emptySrc();
    src.recentByAirport.set('NRT', {
      outbound: [mkQuote({ airline: '酷航', price: 11000 })],
      return: [mkQuote({ airline: '酷航', price: 11200, trip_leg: 'return' })]
    });
    const q = buildWatchQuote(baseSub, src);
    expect(q!.history).toEqual([]);
  });

  it('有 daily → 轉成 PricePoint[] (M/D 格式)', () => {
    const src = emptySrc();
    src.recentByAirport.set('NRT', {
      outbound: [mkQuote({ airline: '酷航', price: 11000 })],
      return: [mkQuote({ airline: '酷航', price: 11200, trip_leg: 'return' })]
    });
    src.daily = [
      { date: '2026-06-08', minPrice: 14000 },
      { date: '2026-06-09', minPrice: 11200 }
    ];
    const q = buildWatchQuote(baseSub, src);
    expect(q!.history).toEqual([
      { d: '6/8', p: 14000 },
      { d: '6/9', p: 11200 }
    ]);
  });
});

describe('buildWatchQuote — 單程訂閱', () => {
  it('return_date=null 的訂閱 → lcc.ret=null（不是 fake 回程航司）', () => {
    const oneWaySub: Subscription = { ...baseSub, return_date: null };
    const src = emptySrc();
    src.recentByAirport.set('NRT', {
      // 單程模式只有 outbound 沒 return
      outbound: [mkQuote({ airline: '酷航', price: 10500, trip_leg: 'outbound' })],
      return: []
    });
    const q = buildWatchQuote(oneWaySub, src);
    // 單程：lcc 來自 outbound fallback；ret 必須是 null
    if (q?.lcc) {
      expect(q.lcc.ret).toBeNull();
    }
  });
});

describe('buildOpenJawWatchQuote — 開口式多城市單一票', () => {
  // 開口式 sub：去 TPE→NRT 1/29、回 HND→TSA 2/5
  const ojSub: Subscription = {
    ...baseSub,
    origin: 'TPE',
    destination: 'NRT',
    outbound_date: '2026-01-29',
    return_date: '2026-02-05',
    return_origin: 'HND',
    return_destination: 'TSA'
  };

  it('沒最近報價 (recentMin=null) → null（前端降級「監控中」）', () => {
    const src: OpenJawQuoteSource = { recentMin: null, recentAirline: null, weekAgoMin: null, daily: [] };
    expect(buildOpenJawWatchQuote(ojSub, src)).toBeNull();
  });

  it('有整程報價 → currentBest=整程總價、openJaw marker 帶航司、lcc/trad 皆 null', () => {
    const src: OpenJawQuoteSource = {
      recentMin: 18683,
      recentAirline: '中華航空',
      weekAgoMin: null,
      daily: []
    };
    const q = buildOpenJawWatchQuote(ojSub, src);
    expect(q).not.toBeNull();
    expect(q!.currentBest).toBe(18683);
    expect(q!.lcc).toBeNull();
    expect(q!.trad).toBeNull();
    // openJaw marker 是 WatchCard 判斷「畫多城市票・航司」而非廉/傳的依據
    expect(q!.openJaw).toEqual({ airline: '中華航空' });
  });

  it('整程價走勢 + delta 照算（用存的整程價，不分機場）', () => {
    const src: OpenJawQuoteSource = {
      recentMin: 18000,
      recentAirline: '中華航空',
      weekAgoMin: 20000,  // 一週前較貴
      daily: [
        { date: '2026-06-20', minPrice: 21000 },
        { date: '2026-06-21', minPrice: 18000 }
      ]
    };
    const q = buildOpenJawWatchQuote(ojSub, src);
    // (18000 - 20000) / 20000 * 100 = -10 → 便宜了 10%
    expect(q!.deltaPct).toBe(-10);
    expect(q!.history).toEqual([
      { d: '6/20', p: 21000 },
      { d: '6/21', p: 18000 }
    ]);
  });

  it('航司可為 null（SerpApi 沒回航司）→ openJaw.airline=null（卡片顯示 dash）', () => {
    const src: OpenJawQuoteSource = { recentMin: 18683, recentAirline: null, weekAgoMin: null, daily: [] };
    const q = buildOpenJawWatchQuote(ojSub, src);
    expect(q!.openJaw).toEqual({ airline: null });
  });

  it('quote 內含 intel 欄位（跟一般 quote 一致，不能漏）', () => {
    const src: OpenJawQuoteSource = { recentMin: 18683, recentAirline: '中華航空', weekAgoMin: null, daily: [] };
    const q = buildOpenJawWatchQuote(ojSub, src);
    expect(q!.intel).toBeDefined();
  });
});

describe('computeDaysUntil — 純字串切，不靠 Date', () => {
  it('壞日期 → null', () => {
    expect(computeDaysUntil(null)).toBeNull();
    expect(computeDaysUntil(undefined)).toBeNull();
    expect(computeDaysUntil('garbage')).toBeNull();
    expect(computeDaysUntil('2026-13-99')).not.toBeNull(); // 沒做 range 檢查，但不 crash
  });

  it('遙遠未來 → 大正數', () => {
    const d = computeDaysUntil('2099-12-31');
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThan(1000);
  });
});

describe('buildWatchQuote — Price Intelligence 整合', () => {
  it('quote 內含 intel 欄位（不能漏）', () => {
    const src = emptySrc();
    src.recentByAirport.set('NRT', {
      outbound: [mkQuote({ airline: '酷航', price: 11000 })],
      return: [mkQuote({ airline: '酷航', price: 11200, trip_leg: 'return' })]
    });
    const q = buildWatchQuote(baseSub, src);
    expect(q).not.toBeNull();
    expect(q!.intel).toBeDefined();
  });

  it('歷史少於 14 點 → intel.status="building"', () => {
    const src = emptySrc();
    src.recentByAirport.set('NRT', {
      outbound: [mkQuote({ airline: '酷航', price: 11000 })],
      return: [mkQuote({ airline: '酷航', price: 11200, trip_leg: 'return' })]
    });
    // 只給 5 點 daily history
    src.daily = Array.from({ length: 5 }, (_, i) => ({
      date: `2026-06-0${i + 1}`,
      minPrice: 11500 + i * 100
    }));
    const q = buildWatchQuote(baseSub, src);
    expect(q!.intel?.status).toBe('building');
    if (q!.intel?.status === 'building') {
      expect(q!.intel.tracked).toBe(5);
      expect(q!.intel.remaining).toBe(MIN_POINTS - 5);
    }
  });

  it('歷史 >= 14 點 → intel.status="ready" + 含 verdict', () => {
    const src = emptySrc();
    src.recentByAirport.set('NRT', {
      outbound: [mkQuote({ airline: '酷航', price: 11000 })],
      return: [mkQuote({ airline: '酷航', price: 11200, trip_leg: 'return' })]
    });
    src.daily = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, '0')}`,
      minPrice: 13000 - i * 100  // 跌勢
    }));
    const q = buildWatchQuote(baseSub, src);
    expect(q!.intel?.status).toBe('ready');
    if (q!.intel?.status === 'ready') {
      expect(['buy', 'lean-buy', 'watch', 'wait']).toContain(q!.intel.verdict);
      expect(q!.intel.reasons.length).toBeGreaterThan(0);
    }
  });

  it('outbound_date null → intel.days null（不 crash）', () => {
    const subAnyDate: Subscription = { ...baseSub, outbound_date: null };
    const src = emptySrc();
    src.recentByAirport.set('NRT', {
      outbound: [mkQuote({ airline: '酷航', price: 11000 })],
      return: [mkQuote({ airline: '酷航', price: 11200, trip_leg: 'return' })]
    });
    src.daily = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-06-${String(i + 1).padStart(2, '0')}`,
      minPrice: 13000 - i * 100
    }));
    const q = buildWatchQuote(subAnyDate, src);
    expect(q!.intel?.days).toBeNull();
  });
});
