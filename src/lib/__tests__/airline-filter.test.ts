/**
 * 航司過濾 — matchesAirlineFilter 純函數 + analyzeFlights 套用
 *
 * 為什麼測：
 *   1. filter 空 = 不過濾（既有訂閱不受影響 — 不能誤把舊行為改掉）
 *   2. 過濾後找最便宜 = 「勾選航司裡的最便宜」，不是全集最便宜
 *      （拿錯 = 使用者勾了只要捷星卻被星宇便宜票觸發，違反設定）
 *   3. displayName 比對（星宇航空/捷星…），跟存進 DB 的值對齊
 */
import { analyzeFlights, findPinnedFlightQuote } from '../flights';
import { matchesAirlineFilter, getAirlineCategory, normalizeAirlineName } from '@/config/airlines';
import type { FlightQuote } from '@/types';

function q(airline: string, price: number, leg: 'outbound' | 'return' = 'outbound'): FlightQuote {
  return {
    origin: 'TPE', destination: 'NRT', outbound_date: '2027-02-04', return_date: null,
    airline, airline_code: null, price, currency: 'TWD', duration_minutes: 180,
    stops: 0, flight_type: 'best', trip_leg: leg
  };
}

describe('matchesAirlineFilter', () => {
  it('filter 空 / null / undefined → 全通過（不過濾）', () => {
    expect(matchesAirlineFilter('捷星', null)).toBe(true);
    expect(matchesAirlineFilter('捷星', undefined)).toBe(true);
    expect(matchesAirlineFilter('捷星', [])).toBe(true);
  });
  it('在清單內 → 通過；不在 → 擋掉', () => {
    expect(matchesAirlineFilter('Jetstar 捷星', ['捷星'])).toBe(true);
    expect(matchesAirlineFilter('星宇航空', ['捷星'])).toBe(false);
  });
  it('用 displayName 比對（normalize 後）', () => {
    expect(matchesAirlineFilter('Starlux', ['星宇航空'])).toBe(true);
    expect(matchesAirlineFilter('EVA Air', ['星宇航空', '長榮航空'])).toBe(true);
  });
  it('新補的台日航司也能比對（華航/日航/全日空/虎航/樂桃）', () => {
    expect(matchesAirlineFilter('China Airlines', ['中華航空'])).toBe(true);
    expect(matchesAirlineFilter('Japan Airlines', ['日本航空'])).toBe(true);
    expect(matchesAirlineFilter('All Nippon Airways', ['全日空'])).toBe(true);
    expect(matchesAirlineFilter('Tigerair Taiwan', ['台灣虎航'])).toBe(true);
    expect(matchesAirlineFilter('Peach', ['樂桃'])).toBe(true);
    // 'Air China'（中國國航）不該誤中『中華航空』
    expect(matchesAirlineFilter('Air China', ['中華航空'])).toBe(false);
  });
  it('未分類冷門航空 → 用原始名（normalize 後＝原值）就能比對（有飛就追）', () => {
    // 沒列在 config 的航空（用合成名確保永遠不被分類）：normalize 回原值，filter 存原值就能勾到
    expect(matchesAirlineFilter('ZZ Test Air', ['ZZ Test Air'])).toBe(true);
    expect(matchesAirlineFilter('ZZ Test Air', ['捷星'])).toBe(false);
  });
});

describe('航司分類（廉航 / 傳統）', () => {
  it('新補航司分類正確：虎航/樂桃=廉航，華航/日航/全日空=傳統', () => {
    expect(getAirlineCategory('Tigerair Taiwan')).toBe('lcc');
    expect(getAirlineCategory('Peach')).toBe('lcc');
    expect(getAirlineCategory('China Airlines')).toBe('full-service');
    expect(getAirlineCategory('Japan Airlines')).toBe('full-service');
    expect(getAirlineCategory('All Nippon Airways')).toBe('full-service');
  });
  it('第五航權直飛航司：泰國獅航=廉航，國泰=傳統', () => {
    expect(getAirlineCategory('Thai Lion Air')).toBe('lcc');
    expect(getAirlineCategory('Cathay Pacific')).toBe('full-service');
    expect(matchesAirlineFilter('Thai Lion Air', ['泰國獅航'])).toBe(true);
    expect(matchesAirlineFilter('Cathay Pacific', ['國泰航空'])).toBe(true);
  });
  it('未分類航空 → category null、normalize 保留原值', () => {
    expect(getAirlineCategory('ZZ Test Air')).toBeNull();
    expect(normalizeAirlineName('ZZ Test Air')).toBe('ZZ Test Air');
  });
});

describe('analyzeFlights — 航司過濾', () => {
  // 捷星最便宜(6000)、星宇次之(8000)、長榮(9000)
  const outbound = [q('捷星', 6000), q('星宇航空', 8000), q('長榮航空', 9000)];

  it('無 filter → 最便宜 = 捷星 6000（舊行為）', () => {
    const a = analyzeFlights(outbound, [], undefined, null);
    expect(a.cheapestRoundTripPrice).toBe(6000);
    expect(a.cheapestAirline).toContain('捷星');
  });

  it('只勾星宇+長榮 → 排除捷星，最便宜變星宇 8000', () => {
    const a = analyzeFlights(outbound, [], undefined, ['星宇航空', '長榮航空']);
    expect(a.cheapestRoundTripPrice).toBe(8000);
    expect(a.cheapestAirline).toContain('星宇');
    // 廉航被全排除 → lccCombo 應為 null
    expect(a.lccCombo).toBeNull();
  });

  it('只勾捷星 → 傳統被排除，traditionalRoundTrip null，最便宜捷星 6000', () => {
    const a = analyzeFlights(outbound, [], undefined, ['捷星']);
    expect(a.cheapestRoundTripPrice).toBe(6000);
    expect(a.traditionalRoundTrip).toBeNull();
  });

  it('勾的航司這條線都沒飛 → 全濾光，無報價', () => {
    const a = analyzeFlights(outbound, [], undefined, ['酷航']);
    expect(a.cheapestRoundTripPrice).toBeNull();
  });

  it('新補航司有分類 → 進廉/傳邏輯（虎航 5500 進 lccCombo、全日空 7000 進 traditionalRoundTrip）', () => {
    const mixed = [q('台灣虎航', 5500), q('全日空', 7000), q('日本航空', 7200)];
    const a = analyzeFlights(mixed, [], undefined, null);
    // 虎航是廉航 → lccCombo 抓得到（驗證它真的驅動價格，不是被忽略）
    expect(a.lccCombo?.price).toBe(5500);
    // 全日空 / 日航是傳統 → traditionalRoundTrip 取最便宜的全日空 7000
    expect(a.traditionalRoundTrip?.price).toBe(7000);
    expect(a.traditionalRoundTrip?.airline).toContain('全日空');
  });
});

describe('analyzeFlights — topAirlines（LINE 警報前 3 家）', () => {
  it('前 3 便宜不同航空：去重保留每家最低、由低到高，第 4 家被擠出', () => {
    const out = [
      q('捷星', 6500), q('捷星', 6000),   // 同家 → 保留最低 6000
      q('酷航', 7000), q('星宇航空', 8000), q('長榮航空', 9000)
    ];
    const a = analyzeFlights(out, [], undefined, null);
    expect(a.topAirlines).toEqual([
      { airline: '捷星', price: 6000 },
      { airline: '酷航', price: 7000 },
      { airline: '星宇航空', price: 8000 }
    ]);  // 長榮 9000 排第 4 → 不在前 3
  });

  it('套用航司過濾 → 只在勾選的航司裡挑前 3', () => {
    const out = [q('捷星', 6000), q('星宇航空', 8000), q('長榮航空', 9000)];
    const a = analyzeFlights(out, [], undefined, ['星宇航空', '長榮航空']);
    expect(a.topAirlines.map(t => t.airline)).toEqual(['星宇航空', '長榮航空']);  // 捷星被排除
  });

  it('不足 3 家 → 有幾家給幾家', () => {
    const a = analyzeFlights([q('捷星', 6000)], [], undefined, null);
    expect(a.topAirlines).toEqual([{ airline: '捷星', price: 6000 }]);
  });
});

describe('analyzeFlights — 釘選航班（方案 B 複選）', () => {
  // 帶 raw.flight_number + 起飛時間的 quote（topAirlines label = '航司 · HH:MM'）
  function qp(airline: string, price: number, flightNumber: string, hhmm = '08:30'): FlightQuote {
    return {
      ...q(airline, price),
      raw: { flights: [{ flight_number: flightNumber, departure_airport: { time: `2027-02-04 ${hhmm}` } }] }
    };
  }

  it('釘選單一班號 → 只回那一班的價格 + topAirlines 只有它（label 帶時間）', () => {
    const out = [qp('捷星', 6077, 'GK 13', '08:30'), qp('酷航', 5500, 'TR 1', '13:00'), qp('捷星', 9000, 'GK 99', '20:00')];
    const a = analyzeFlights(out, [], undefined, null, ['GK 13']);
    expect(a.cheapestRoundTripPrice).toBe(6077);   // 不是全集最低 5500
    expect(a.cheapestAirline).toContain('捷星');
    expect(a.topAirlines).toEqual([{ airline: '捷星 · 08:30', price: 6077 }]);
  });

  it('釘選多班（複選）→ topAirlines 條列全部釘選班，trigger 用最低那班', () => {
    const out = [qp('捷星', 6077, 'GK 13', '08:30'), qp('酷航', 5500, 'TR 1', '13:00'), qp('捷星', 9000, 'GK 99', '20:00')];
    const a = analyzeFlights(out, [], undefined, null, ['GK 13', 'TR 1']);
    expect(a.cheapestRoundTripPrice).toBe(5500);    // 釘選裡最低的（觸發告警用）
    // 條列全部釘選班（不縮成最便宜一家），由便宜到貴
    expect(a.topAirlines).toEqual([
      { airline: '酷航 · 13:00', price: 5500 },
      { airline: '捷星 · 08:30', price: 6077 }
    ]);
  });

  it('複選但只找到部分班 → 只回找到的那幾班', () => {
    const out = [qp('捷星', 6077, 'GK 13', '08:30')];
    const a = analyzeFlights(out, [], undefined, null, ['GK 13', 'TR 1']);  // TR 1 沒報價
    expect(a.cheapestRoundTripPrice).toBe(6077);
    expect(a.topAirlines).toEqual([{ airline: '捷星 · 08:30', price: 6077 }]);
  });

  it('找不到任何釘選班 → cheapestRoundTripPrice = null（caller 當暫無報價）', () => {
    const a = analyzeFlights([qp('酷航', 5500, 'TR 1')], [], undefined, null, ['GK 13']);
    expect(a.cheapestRoundTripPrice).toBeNull();
    expect(a.topAirlines).toEqual([]);
  });

  it('釘選優先 — 忽略航司過濾（釘的班即使不在 filter 也回）', () => {
    const out = [qp('捷星', 6077, 'GK 13')];
    const a = analyzeFlights(out, [], undefined, ['星宇航空'], ['GK 13']);  // filter 不含捷星
    expect(a.cheapestRoundTripPrice).toBe(6077);
  });

  it('findPinnedFlightQuote：同班號多筆 → 取最低價那筆', () => {
    const out = [qp('捷星', 6500, 'GK 13'), qp('捷星', 6000, 'GK 13')];
    expect(findPinnedFlightQuote(out, 'GK 13')?.price).toBe(6000);
    expect(findPinnedFlightQuote(out, 'XX 99')).toBeNull();
  });
});
