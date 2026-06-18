/**
 * 航司過濾 — matchesAirlineFilter 純函數 + analyzeFlights 套用
 *
 * 為什麼測：
 *   1. filter 空 = 不過濾（既有訂閱不受影響 — 不能誤把舊行為改掉）
 *   2. 過濾後找最便宜 = 「勾選航司裡的最便宜」，不是全集最便宜
 *      （拿錯 = 使用者勾了只要捷星卻被星宇便宜票觸發，違反設定）
 *   3. displayName 比對（星宇航空/捷星…），跟存進 DB 的值對齊
 */
import { analyzeFlights } from '../flights';
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
    // 沒列在 config 的航空：normalizeAirlineName 回原值，filter 存原值就能勾到
    expect(matchesAirlineFilter('Cathay Pacific', ['Cathay Pacific'])).toBe(true);
    expect(matchesAirlineFilter('Cathay Pacific', ['捷星'])).toBe(false);
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
  it('未分類航空 → category null、normalize 保留原值', () => {
    expect(getAirlineCategory('Cathay Pacific')).toBeNull();
    expect(normalizeAirlineName('Cathay Pacific')).toBe('Cathay Pacific');
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
