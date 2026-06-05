/**
 * 起飛時段窗口過濾 (TimeFilter) — 端對端驗證
 *
 * 確認的事：
 *   1. extractDepartureHHMM 能從 SerpApi 真實 raw 格式正確抽出 'HH:MM'
 *   2. filterByDepartureTime 4 種窗口組合都行為正確
 *   3. analyzeFlights 把 filter 套用後再 pickCheapest，會挑到「窗口內最便宜」
 *      而不是「全集最便宜」
 *   4. 邊界條件：min == max（同時刻 OK）、t == min/max 等號（包含）
 *
 * Run: pnpm test flights-time-filter
 */

import { analyzeFlights, extractDepartureHHMM, type TimeFilter } from '../flights';
import type { FlightQuote } from '@/types';

/**
 * 造一筆 FlightQuote 的工廠。SerpApi 的時間格式是 'YYYY-MM-DD HH:MM'
 * 我們在 raw.flights[0].departure_airport.time 放這個格式
 */
function makeQuote(opts: {
  airline: string;
  price: number;
  trip_leg: 'outbound' | 'return';
  depTime: string;  // 'YYYY-MM-DD HH:MM'
}): FlightQuote {
  return {
    origin: 'TPE',
    destination: 'HND',
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
    raw: {
      flights: [
        {
          airline: opts.airline,
          flight_number: 'XX1234',
          departure_airport: { id: 'TPE', name: '桃園', time: opts.depTime },
          arrival_airport: { id: 'HND', name: '羽田', time: '2027-02-04 10:00' }
        }
      ],
      total_duration: 180,
      price: opts.price
    } as unknown
  };
}

describe('extractDepartureHHMM', () => {
  it('parses SerpApi format "YYYY-MM-DD HH:MM"', () => {
    const q = makeQuote({ airline: '長榮航空', price: 25000, trip_leg: 'outbound', depTime: '2027-02-04 06:25' });
    expect(extractDepartureHHMM(q)).toBe('06:25');
  });

  it('handles midnight / single-digit padding', () => {
    expect(extractDepartureHHMM(makeQuote({ airline: 'X', price: 0, trip_leg: 'outbound', depTime: '2027-02-04 00:05' }))).toBe('00:05');
    expect(extractDepartureHHMM(makeQuote({ airline: 'X', price: 0, trip_leg: 'outbound', depTime: '2027-02-04 23:59' }))).toBe('23:59');
  });

  it('returns null on missing raw / missing time field (fail-open)', () => {
    const noRaw: FlightQuote = { ...makeQuote({ airline: 'X', price: 0, trip_leg: 'outbound', depTime: '2027-02-04 12:00' }), raw: undefined };
    expect(extractDepartureHHMM(noRaw)).toBeNull();

    const noTime: FlightQuote = {
      ...makeQuote({ airline: 'X', price: 0, trip_leg: 'outbound', depTime: '2027-02-04 12:00' }),
      raw: { flights: [{ airline: 'X', departure_airport: { id: 'TPE' }, arrival_airport: { id: 'HND' } }] } as unknown
    };
    expect(extractDepartureHHMM(noTime)).toBeNull();
  });
});

describe('analyzeFlights with TimeFilter — 4 combos × pick-cheapest semantics', () => {
  // 6 種去程：時間 + 價格的不同組合
  // 廉航最便宜的是 06:00 (NT$ 8000)，但太早；下一個是 12:00 (NT$ 9500)
  // 傳統最便宜的是 04:00 (NT$ 22000)，但太早；下一個是 10:00 (NT$ 25000)
  const OUTBOUND: FlightQuote[] = [
    makeQuote({ airline: '酷航',     price:  8000, trip_leg: 'outbound', depTime: '2027-02-04 06:00' }),  // 廉航・很早
    makeQuote({ airline: '捷星',     price:  9500, trip_leg: 'outbound', depTime: '2027-02-04 12:00' }),  // 廉航・中午
    makeQuote({ airline: '酷航',     price: 11000, trip_leg: 'outbound', depTime: '2027-02-04 18:00' }),  // 廉航・傍晚
    makeQuote({ airline: '長榮航空', price: 22000, trip_leg: 'outbound', depTime: '2027-02-04 04:00' }),  // 傳統・很早
    makeQuote({ airline: '星宇航空', price: 25000, trip_leg: 'outbound', depTime: '2027-02-04 10:00' }),  // 傳統・上午
    makeQuote({ airline: '長榮航空', price: 28000, trip_leg: 'outbound', depTime: '2027-02-04 20:00' })   // 傳統・晚上
  ];
  // 回程簡化：跟 outbound 對齊，因為 LCC mix-and-match 在 fallback 時用 outbound 估算
  // 為了測 filter 套用到 return 也獨立，給幾筆不同時間
  const RETURN: FlightQuote[] = [
    makeQuote({ airline: '捷星',     price:  9500, trip_leg: 'return',   depTime: '2027-02-08 08:00' }),  // 廉航・早
    makeQuote({ airline: '酷航',     price: 10500, trip_leg: 'return',   depTime: '2027-02-08 16:00' }),  // 廉航・午後
    makeQuote({ airline: '星宇航空', price: 25000, trip_leg: 'return',   depTime: '2027-02-08 09:00' })   // 傳統・上午
  ];

  it('no filter (all empty) → picks 廉航 06:00 (cheapest overall)', () => {
    const a = analyzeFlights(OUTBOUND, RETURN);
    expect(a.lccCombo?.price).toBe(9500);  // ret list 最便宜是捷星 9500 → 配對精確
    expect(a.traditionalRoundTrip?.airline).toBe('長榮航空');
    expect(a.traditionalRoundTrip?.price).toBe(22000);  // pickTraditional 直接取 outbound 列表
  });

  it('outbound min=12:00 → 早於 12:00 的去程被擋掉，挑 12:00 捷星 9500', () => {
    const f: TimeFilter = { outboundMin: '12:00' };
    const a = analyzeFlights(OUTBOUND, RETURN, f);
    // 廉航最便宜 outbound 變成 12:00 捷星 (9500)；同家來回 fallback 估算
    expect(a.lccCombo).not.toBeNull();
    expect(a.lccCombo!.outboundAirline).toBe('捷星');
    // 傳統最便宜變成 10:00 不行，要 >= 12:00 → 20:00 長榮 28000
    expect(a.traditionalRoundTrip?.price).toBe(28000);
  });

  it('outbound max=12:00 → 晚於 12:00 的去程被擋掉，挑 06:00 酷航 8000', () => {
    const f: TimeFilter = { outboundMax: '12:00' };
    const a = analyzeFlights(OUTBOUND, RETURN, f);
    expect(a.lccCombo).not.toBeNull();
    expect(a.lccCombo!.outboundAirline).toBe('酷航');
    // 傳統 04:00 長榮 22000 通過、10:00 星宇 25000 通過、20:00 長榮被擋
    expect(a.traditionalRoundTrip?.price).toBe(22000);
  });

  it('outbound min=10:00 max=14:00 → 窗口內僅 12:00 捷星 + 10:00 星宇', () => {
    const f: TimeFilter = { outboundMin: '10:00', outboundMax: '14:00' };
    const a = analyzeFlights(OUTBOUND, RETURN, f);
    expect(a.lccCombo?.outboundAirline).toBe('捷星');
    expect(a.traditionalRoundTrip?.airline).toBe('星宇航空');
    expect(a.traditionalRoundTrip?.price).toBe(25000);
  });

  it('return max=10:00 → 回程晚於 10:00 的被擋；ret 列表只剩 08:00 捷星', () => {
    const f: TimeFilter = { returnMax: '10:00' };
    const a = analyzeFlights(OUTBOUND, RETURN, f);
    // ret 列表剩捷星 8:00 (9500) + 星宇 9:00 (25000)
    // pickLccCombo 從 ret 抓最便宜廉航 → 捷星 9500
    expect(a.lccCombo?.price).toBe(9500);
    expect(a.lccCombo?.isEstimate).toBe(false);  // 精確配對而非 fallback
  });

  it('return min/max 互不影響 outbound 的選擇', () => {
    const f: TimeFilter = { returnMin: '14:00', returnMax: '20:00' };
    const a = analyzeFlights(OUTBOUND, RETURN, f);
    // outbound 沒過濾，最便宜廉航仍是 06:00 酷航
    // ret 列表剩酷航 16:00 (10500) → 配對 outbound 任何
    expect(a.lccCombo?.price).toBe(10500);
    // traditional 從 outbound 抓，不受 return 過濾影響
    expect(a.traditionalRoundTrip?.price).toBe(22000);
  });
});

describe('TimeFilter boundary cases', () => {
  const Q_NOON = makeQuote({ airline: '酷航', price: 1, trip_leg: 'outbound', depTime: '2027-02-04 12:00' });

  it('min 與時刻完全相同 → 包含 (>=)', () => {
    const a = analyzeFlights([Q_NOON], [], { outboundMin: '12:00' });
    expect(a.traditionalRoundTrip).toBeNull();  // 酷航是廉航
    expect(a.lccCombo).not.toBeNull();           // 12:00 == 12:00 通過
  });

  it('max 與時刻完全相同 → 包含 (<=)', () => {
    const a = analyzeFlights([Q_NOON], [], { outboundMax: '12:00' });
    expect(a.lccCombo).not.toBeNull();
  });

  it('min == max == 時刻 → 唯一通過', () => {
    const a = analyzeFlights([Q_NOON], [], { outboundMin: '12:00', outboundMax: '12:00' });
    expect(a.lccCombo).not.toBeNull();
  });

  it('差 1 分鐘擋下（max=11:59）', () => {
    const a = analyzeFlights([Q_NOON], [], { outboundMax: '11:59' });
    expect(a.lccCombo).toBeNull();
  });

  it('全部過濾掉時，analysis 為 null + outboundCount=0', () => {
    const a = analyzeFlights([Q_NOON], [], { outboundMin: '23:00' });
    expect(a.lccCombo).toBeNull();
    expect(a.cheapestOutbound).toBeNull();
    expect(a.outboundCount).toBe(0);
    expect(a.cheapestRoundTripPrice).toBeNull();
  });

  it('null/undefined filter 與不傳 filter 行為一致（不過濾）', () => {
    const a1 = analyzeFlights([Q_NOON], []);
    const a2 = analyzeFlights([Q_NOON], [], {});
    const a3 = analyzeFlights([Q_NOON], [], { outboundMin: null, outboundMax: null, returnMin: null, returnMax: null });
    expect(a1.lccCombo?.price).toBe(1);
    expect(a2.lccCombo?.price).toBe(1);
    expect(a3.lccCombo?.price).toBe(1);
  });

  it('取不到時間的 quote → fail-open（保留）', () => {
    const noTime: FlightQuote = { ...Q_NOON, raw: { flights: [] } as unknown };
    const a = analyzeFlights([noTime], [], { outboundMin: '23:00' });
    // 取不到時間 → 不被擋 → 應該還在
    expect(a.lccCombo).not.toBeNull();
  });
});
