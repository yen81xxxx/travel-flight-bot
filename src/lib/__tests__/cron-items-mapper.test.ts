/**
 * Cron items mapper — 把 (Subscription, RouteOutcome) → MultiSubsItem 的純函數。
 *
 * 為什麼重要：
 *   - 卡片顯示「廉航/傳統最低」「vs 昨日 ↑X%」「⏸ 配額暫滿」全靠這層判斷
 *   - 重構時最常踩坑：改 time-filter 影響配額判斷、改 vsPrev 漏處理零除...
 *   - 5 種空狀態 (no route / quota / no-match / no LCC / no Traditional) × 多機場 fanout
 *     的組合矩陣大，沒測試瞎改必出包
 *
 * 涵蓋：
 *   - 5 種空狀態正確分流
 *   - 跨機場挑最便宜（多機場 fanout，東京 HND+NRT 邏輯）
 *   - 時段窗口套用到 outbound + return 各自獨立
 *   - 跨類比價：LCC vs Traditional 誰勝出
 *   - vsPrev delta 計算（含 null / 零除防呆）
 *   - maxPriceTraditional 不漏帶
 */

import { buildMultiSubsItem, buildOpenJawItem, isOpenJaw, type RouteData, type RouteOutcome } from '../cron-items-mapper';
import type { Subscription, FlightQuote, SerpApiFlight } from '@/types';

// ===== fixtures =====

function makeQuote(opts: {
  origin?: string;
  destination?: string;
  airline: string;
  price: number;
  trip_leg: 'outbound' | 'return';
  depTime?: string;  // 'HH:MM'
}): FlightQuote {
  const dateTime = opts.depTime ? `2027-02-04 ${opts.depTime}` : '2027-02-04 12:00';
  const raw: SerpApiFlight = {
    flights: [
      {
        airline: opts.airline,
        flight_number: 'XX001',
        departure_airport: { id: opts.origin ?? 'TPE', time: dateTime },
        arrival_airport: { id: opts.destination ?? 'HND', time: dateTime }
      }
    ],
    total_duration: 180,
    price: opts.price
  };
  return {
    origin: opts.origin ?? 'TPE',
    destination: opts.destination ?? 'HND',
    outbound_date: '2027-02-04',
    return_date: '2027-02-08',
    airline: opts.airline,
    airline_code: null,
    price: opts.price,
    currency: 'TWD',
    duration_minutes: 180,
    stops: 0,
    flight_type: 'best',
    trip_leg: opts.trip_leg,
    raw
  };
}

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 1,
    source_id: 'Uxxxxx',
    source_type: 'user',
    origin: 'TPE',
    destination: 'HND',
    outbound_date: '2027-02-04',
    return_date: '2027-02-08',
    max_price: 15000,
    currency: 'TWD',
    active: true,
    paused: false,
    label: null,
    ...overrides
  };
}

function makeFanout(opts: {
  airport?: string;
  outbound: FlightQuote[];
  return: FlightQuote[];
}): RouteData['fanout'][number] {
  return {
    airport: opts.airport ?? 'HND',
    outbound: opts.outbound,
    return: opts.return,
    fromCache: false,
    queriedAt: '2026-06-06T00:00:00Z'
  };
}

function makeRoute(overrides: Partial<RouteData> = {}): RouteData {
  return {
    fanout: [],
    previousMins: { lcc: null, traditional: null },
    bestCachedAt: null,
    fromCacheAll: false,
    ...overrides
  };
}

// ===== tests =====

describe('buildMultiSubsItem — 5 種空狀態分流', () => {
  it('route undefined → 空狀態、無 errorReason', () => {
    const sub = makeSub();
    const item = buildMultiSubsItem(sub, undefined);
    expect(item.cheapestPrice).toBeNull();
    expect(item.errorReason).toBeNull();
    expect(item.origin).toBe('TPE');
    expect(item.maxPrice).toBe(15000);
  });

  it('route null → 空狀態、無 errorReason（同 undefined）', () => {
    const item = buildMultiSubsItem(makeSub(), null);
    expect(item.cheapestPrice).toBeNull();
    expect(item.errorReason).toBeNull();
  });

  it('RouteError quota-exhausted → 空狀態 + errorReason 帶上去', () => {
    const route: RouteOutcome = { error: 'quota-exhausted' };
    const item = buildMultiSubsItem(makeSub(), route);
    expect(item.cheapestPrice).toBeNull();
    expect(item.errorReason).toBe('quota-exhausted');
  });

  it('route 有資料但 LCC + 傳統都過濾光 → 空狀態 + errorReason=null', () => {
    // outbound 只有 11:00 廉航，被 timeFilter 12:00 後擋掉
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: [makeQuote({ airline: '捷星', price: 10000, trip_leg: 'outbound', depTime: '11:00' })],
        return: []
      })]
    });
    const sub = makeSub({ outbound_min_departure_time: '12:00' });
    const item = buildMultiSubsItem(sub, route);
    expect(item.cheapestPrice).toBeNull();
    expect(item.errorReason).toBeNull();  // 不是配額問題、是真的沒匹配
  });
});

describe('buildMultiSubsItem — 跨機場 fanout 挑最便宜', () => {
  it('東京雙機場 HND vs NRT → 挑便宜的勝出機場', () => {
    const route = makeRoute({
      fanout: [
        makeFanout({
          airport: 'HND',
          outbound: [makeQuote({ airline: '捷星', price: 14000, trip_leg: 'outbound' })],
          return: [makeQuote({ airline: '捷星', price: 14000, trip_leg: 'return' })]
        }),
        makeFanout({
          airport: 'NRT',
          outbound: [makeQuote({ airline: '捷星', price: 12000, trip_leg: 'outbound' })],
          return: [makeQuote({ airline: '捷星', price: 12000, trip_leg: 'return' })]
        })
      ]
    });
    const item = buildMultiSubsItem(makeSub(), route);
    expect(item.cheapestPrice).toBe(12000);
    expect(item.cheapestAirport).toBe('NRT');
    expect(item.cheapestCategory).toBe('lcc');
  });

  it('一個機場有廉航、另一個機場有傳統 → lcc / traditional 分別記錄勝出機場', () => {
    const route = makeRoute({
      fanout: [
        makeFanout({
          airport: 'HND',
          outbound: [makeQuote({ airline: '星宇航空', price: 25000, trip_leg: 'outbound' })],
          return: []
        }),
        makeFanout({
          airport: 'NRT',
          outbound: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'outbound' })],
          return: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'return' })]
        })
      ]
    });
    const item = buildMultiSubsItem(makeSub(), route);
    expect(item.lcc?.airport).toBe('NRT');
    expect(item.lcc?.price).toBe(13000);
    expect(item.traditional?.airport).toBe('HND');
    expect(item.traditional?.price).toBe(25000);
    // 整體最便宜是廉航 13000
    expect(item.cheapestCategory).toBe('lcc');
    expect(item.cheapestPrice).toBe(13000);
  });
});

describe('buildMultiSubsItem — 時段窗口過濾', () => {
  const BASE_QUOTES = (leg: 'outbound' | 'return'): FlightQuote[] => [
    makeQuote({ airline: '捷星', price: 10000, trip_leg: leg, depTime: '06:00' }),  // 太早
    makeQuote({ airline: '捷星', price: 12000, trip_leg: leg, depTime: '14:00' }),  // 窗口內
    makeQuote({ airline: '捷星', price: 13000, trip_leg: leg, depTime: '20:00' })   // 太晚
  ];

  it('套用 outbound + return 同樣窗口 [12:00, 16:00] → 只剩 14:00 兩端', () => {
    // 注意：pickLccCombo 用 return list 的 price 當「配對精確總價」，所以單只設
    // outbound 窗口不夠 — return 06:00 那班還是會被選中，價格會用 return list 的。
    // 真實使用情境會兩段都設窗口（user 不想搭 06:00 起飛 = 兩段都不想）。
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: BASE_QUOTES('outbound'),
        return: BASE_QUOTES('return')
      })]
    });
    const sub = makeSub({
      outbound_min_departure_time: '12:00',
      outbound_max_departure_time: '16:00',
      return_min_departure_time: '12:00',
      return_max_departure_time: '16:00'
    });
    const item = buildMultiSubsItem(sub, route);
    // outbound 14:00 + return 14:00 都通過 → pickLccCombo 拿 return list 的 12000 當配對總價
    expect(item.lcc?.price).toBe(12000);
  });

  it('只設 outbound 窗口、return 不設 → return list 06:00 仍會被當配對總價選中', () => {
    // 這是已知設計：return list 的 price 是 outbound+return 配對的精確總價，
    // 即使 outbound 被 user 過濾掉，pickLccCombo 還是會用 return list 最便宜的那筆。
    // 解法：user 想避開早班就「去 + 回都設窗口」。Cron 不會自動傳遞 outbound 窗口到 return。
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: BASE_QUOTES('outbound'),
        return: BASE_QUOTES('return')
      })]
    });
    const sub = makeSub({
      outbound_min_departure_time: '12:00',
      outbound_max_departure_time: '16:00'
      // return 沒設
    });
    const item = buildMultiSubsItem(sub, route);
    // return 06:00 那班 10000 是 cheapest combo
    expect(item.lcc?.price).toBe(10000);
  });

  it('outbound 跟 return 窗口獨立 → 兩段各自過濾', () => {
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: BASE_QUOTES('outbound'),
        return: BASE_QUOTES('return')
      })]
    });
    const sub = makeSub({
      outbound_max_departure_time: '08:00',   // 去程只能 06:00
      return_min_departure_time: '18:00'      // 回程只能 20:00
    });
    const item = buildMultiSubsItem(sub, route);
    // outbound 06:00 還在；return 20:00 還在；分析應該有結果
    expect(item.cheapestPrice).not.toBeNull();
  });
});

describe('buildMultiSubsItem — LCC vs Traditional 跨類比價', () => {
  it('LCC 比較便宜 → cheapestCategory=lcc，airline 帶 outboundAirline', () => {
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: [
          makeQuote({ airline: '捷星', price: 13000, trip_leg: 'outbound' }),
          makeQuote({ airline: '星宇航空', price: 25000, trip_leg: 'outbound' })
        ],
        return: [
          makeQuote({ airline: '捷星', price: 13000, trip_leg: 'return' })
        ]
      })]
    });
    const item = buildMultiSubsItem(makeSub(), route);
    expect(item.cheapestCategory).toBe('lcc');
    expect(item.cheapestPrice).toBe(13000);
    expect(item.cheapestAirline).toBe('捷星');
  });

  it('傳統比較便宜 → cheapestCategory=full-service', () => {
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: [
          makeQuote({ airline: '捷星', price: 18000, trip_leg: 'outbound' }),
          makeQuote({ airline: '長榮航空', price: 15000, trip_leg: 'outbound' })
        ],
        return: [
          makeQuote({ airline: '捷星', price: 18000, trip_leg: 'return' })
        ]
      })]
    });
    const item = buildMultiSubsItem(makeSub(), route);
    expect(item.cheapestCategory).toBe('full-service');
    expect(item.cheapestPrice).toBe(15000);
    expect(item.cheapestAirline).toBe('長榮航空');
  });

  it('LCC = Traditional 同價 → LCC 勝出 (邊界，<= )', () => {
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: [
          makeQuote({ airline: '捷星', price: 16000, trip_leg: 'outbound' }),
          makeQuote({ airline: '長榮航空', price: 16000, trip_leg: 'outbound' })
        ],
        return: [
          makeQuote({ airline: '捷星', price: 16000, trip_leg: 'return' })
        ]
      })]
    });
    const item = buildMultiSubsItem(makeSub(), route);
    expect(item.cheapestCategory).toBe('lcc');
  });
});

describe('buildMultiSubsItem — vsPrev delta 計算', () => {
  it('previousMins 有值 → 算 % delta', () => {
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'outbound' })],
        return: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'return' })]
      })],
      previousMins: { lcc: 10000, traditional: null }  // 昨天 10000
    });
    const item = buildMultiSubsItem(makeSub(), route);
    // (13000 - 10000) / 10000 = 30% 漲
    expect(item.vsPrevPct).toBe(30);
    expect(item.lcc?.vsPrevPct).toBe(30);
  });

  it('previousMins null → vsPrev null（首次抓到的路線）', () => {
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'outbound' })],
        return: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'return' })]
      })],
      previousMins: { lcc: null, traditional: null }
    });
    const item = buildMultiSubsItem(makeSub(), route);
    expect(item.vsPrevPct).toBeNull();
  });

  it('previousMins 為 0 → vsPrev null（防呆零除）', () => {
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'outbound' })],
        return: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'return' })]
      })],
      previousMins: { lcc: 0, traditional: 0 }
    });
    const item = buildMultiSubsItem(makeSub(), route);
    expect(item.vsPrevPct).toBeNull();
  });

  it('跨類比較時，vsPrev 用「勝出類」的 baseline 算（不是亂混）', () => {
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: [
          makeQuote({ airline: '捷星', price: 13000, trip_leg: 'outbound' }),
          makeQuote({ airline: '長榮航空', price: 11000, trip_leg: 'outbound' })
        ],
        return: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'return' })]
      })],
      previousMins: { lcc: 20000, traditional: 12000 }
    });
    const item = buildMultiSubsItem(makeSub(), route);
    // 傳統 11000 勝出；vsPrev 該用 traditional baseline 12000
    expect(item.cheapestCategory).toBe('full-service');
    // (11000 - 12000) / 12000 = -8.33% → round = -8
    expect(item.vsPrevPct).toBe(-8);
  });
});

describe('buildMultiSubsItem — 欄位帶值不漏', () => {
  it('maxPriceTraditional 有設 → 帶到 item', () => {
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'outbound' })],
        return: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'return' })]
      })]
    });
    const sub = makeSub({ max_price_traditional: 25000 });
    const item = buildMultiSubsItem(sub, route);
    expect(item.maxPriceTraditional).toBe(25000);
  });

  it('maxPriceTraditional 沒設 → null', () => {
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'outbound' })],
        return: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'return' })]
      })]
    });
    const item = buildMultiSubsItem(makeSub(), route);
    expect(item.maxPriceTraditional).toBeNull();
  });

  it('label 有 → 帶到 item', () => {
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'outbound' })],
        return: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'return' })]
      })]
    });
    const sub = makeSub({ label: '農曆年計畫' });
    const item = buildMultiSubsItem(sub, route);
    expect(item.label).toBe('農曆年計畫');
  });
});

describe('buildMultiSubsItem — 單程訂閱 (return_date = null)', () => {
  it('return_date null → item.returnDate 也是 null（不變空字串）', () => {
    const sub = makeSub({ return_date: null });
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'outbound' })],
        return: []  // 單程：沒 return list
      })]
    });
    const item = buildMultiSubsItem(sub, route);
    expect(item.returnDate).toBeNull();
    expect(item.outboundDate).toBe('2027-02-04');
  });

  it('return_date null + 空 route → 空 item，returnDate 還是 null', () => {
    const sub = makeSub({ return_date: null });
    const item = buildMultiSubsItem(sub, undefined);
    expect(item.returnDate).toBeNull();
    expect(item.cheapestPrice).toBeNull();
  });

  it('單程訂閱 + 有資料 → analyzeFlights 退到 outbound 估算（isEstimate=true）', () => {
    const sub = makeSub({ return_date: null });
    const route = makeRoute({
      fanout: [makeFanout({
        outbound: [makeQuote({ airline: '捷星', price: 13000, trip_leg: 'outbound' })],
        return: []  // 單程
      })]
    });
    const item = buildMultiSubsItem(sub, route);
    // pickLccCombo fallback：return list 空 → 取 outbound 估算
    expect(item.lcc?.price).toBe(13000);
    expect(item.lcc?.isEstimate).toBe(true);  // ★ 標 fallback
  });
});

describe('buildMultiSubsItem — quota-exhausted 不會被誤導向 no-match', () => {
  it('就算 fanout 為空，只要 error 標記是 quota-exhausted 就要帶上去', () => {
    const route: RouteOutcome = { error: 'quota-exhausted' };
    const item = buildMultiSubsItem(makeSub(), route);
    expect(item.errorReason).toBe('quota-exhausted');
    expect(item.cheapestPrice).toBeNull();
  });
});

describe('buildMultiSubsItem — topAirlines（比照降價警報卡顯示前 3 家）', () => {
  it('跨機場 merge → 取最便宜 3 家、由低到高；同航司留最低價', () => {
    const route = makeRoute({
      fanout: [
        makeFanout({
          airport: 'HND',
          outbound: [
            makeQuote({ airline: '捷星', price: 14000, trip_leg: 'outbound' }),
            makeQuote({ airline: '酷航', price: 9000, trip_leg: 'outbound' }),
            makeQuote({ airline: '星宇航空', price: 13000, trip_leg: 'outbound' })
          ],
          return: [makeQuote({ airline: '酷航', price: 9000, trip_leg: 'return' })]
        }),
        makeFanout({
          airport: 'NRT',
          outbound: [
            makeQuote({ airline: '樂桃', price: 8000, trip_leg: 'outbound' }),
            makeQuote({ airline: '捷星', price: 12000, trip_leg: 'outbound' })  // 捷星更便宜的那筆
          ],
          return: [makeQuote({ airline: '樂桃', price: 8000, trip_leg: 'return' })]
        })
      ]
    });
    const item = buildMultiSubsItem(makeSub({ max_price: 99999 }), route);
    // 前 3 便宜：樂桃 8000、酷航 9000、捷星 12000（捷星跨機場取最低 12000，不是 14000）；星宇 13000 落榜
    expect(item.topAirlines).toEqual([
      { airline: '樂桃', price: 8000 },
      { airline: '酷航', price: 9000 },
      { airline: '捷星', price: 12000 }
    ]);
  });

  it('沒匹配航班（空狀態）→ topAirlines 不存在（undefined）', () => {
    const item = buildMultiSubsItem(makeSub(), undefined);
    expect(item.topAirlines).toBeUndefined();
  });
});

describe('buildOpenJawItem — 開口式來回（兩段相加，0015）', () => {
  const oneWayRoute = (quotes: FlightQuote[]): RouteData =>
    makeRoute({ fanout: [makeFanout({ airport: 'X', outbound: quotes, return: [] })] });
  const ojSub = (over: Partial<Subscription> = {}) => makeSub({
    origin: 'TPE', destination: 'NRT', outbound_date: '2027-01-29', return_date: '2027-02-05',
    return_origin: 'HND', return_destination: 'TSA', max_price: 99999, ...over
  });

  it('isOpenJaw：兩欄都有值才算', () => {
    expect(isOpenJaw({ return_origin: 'HND', return_destination: 'TSA' })).toBe(true);
    expect(isOpenJaw({ return_origin: 'HND', return_destination: null })).toBe(false);
    expect(isOpenJaw({ return_origin: null, return_destination: null })).toBe(false);
  });

  it('兩段都有料 → 合併價 = 兩段最低相加 + 各段 topAirlines/路線', () => {
    const legOut = oneWayRoute([
      makeQuote({ airline: '樂桃', price: 5000, trip_leg: 'outbound' }),
      makeQuote({ airline: '捷星', price: 6000, trip_leg: 'outbound' })
    ]);
    const legBack = oneWayRoute([makeQuote({ airline: '台灣虎航', price: 4000, trip_leg: 'outbound' })]);
    const item = buildOpenJawItem(ojSub(), legOut, legBack);
    expect(item.cheapestPrice).toBe(9000);   // 5000 + 4000
    expect(item.cheapestCategory).toBeNull();
    expect(item.openJaw?.out.price).toBe(5000);
    expect(item.openJaw?.back.price).toBe(4000);
    expect(item.openJaw?.out.topAirlines).toEqual([{ airline: '樂桃', price: 5000 }, { airline: '捷星', price: 6000 }]);
    expect(item.openJaw?.back.topAirlines).toEqual([{ airline: '台灣虎航', price: 4000 }]);
    expect(item.openJaw?.out.destination).toBe('NRT');
    expect(item.openJaw?.back.origin).toBe('HND');
    expect(item.openJaw?.back.destination).toBe('TSA');
    expect(item.openJaw?.back.date).toBe('2027-02-05');
  });

  it('任一段沒料 → 合併價 null（caller 當暫無報價）', () => {
    const legOut = oneWayRoute([makeQuote({ airline: '樂桃', price: 5000, trip_leg: 'outbound' })]);
    const item = buildOpenJawItem(ojSub(), legOut, undefined);   // 回段沒查到
    expect(item.cheapestPrice).toBeNull();
    expect(item.openJaw?.out.price).toBe(5000);
    expect(item.openJaw?.back.price).toBeNull();
  });

  it('某段配額用光 → errorReason=quota-exhausted、合併價 null', () => {
    const legOut = oneWayRoute([makeQuote({ airline: '樂桃', price: 5000, trip_leg: 'outbound' })]);
    const item = buildOpenJawItem(ojSub(), legOut, { error: 'quota-exhausted' });
    expect(item.cheapestPrice).toBeNull();
    expect(item.errorReason).toBe('quota-exhausted');
  });

  it('回段時段過濾用 return_min/max（對應單程 outbound 時間）', () => {
    const sub = ojSub({ return_min_departure_time: '12:00' });
    const legOut = oneWayRoute([makeQuote({ airline: '樂桃', price: 5000, trip_leg: 'outbound', depTime: '08:00' })]);
    const legBack = oneWayRoute([
      makeQuote({ airline: '台灣虎航', price: 4000, trip_leg: 'outbound', depTime: '11:00' }),  // 12:00 前 → 擋
      makeQuote({ airline: '酷航', price: 4500, trip_leg: 'outbound', depTime: '14:00' })
    ]);
    const item = buildOpenJawItem(sub, legOut, legBack);
    expect(item.openJaw?.back.price).toBe(4500);   // 11:00 的 4000 被擋，取 14:00 的 4500
  });
});
