/**
 * Cron 把 (Subscription, RouteResult) 對應成 MultiSubsItem 的純函數。
 *
 * 抽出來的目的：
 *   - 這段邏輯多次被改壞（時間過濾、配額判斷、跨機場挑最低混淆）
 *   - 之前藏在 daily-search/route.ts 的 closure 裡，不能單獨測試
 *   - 包含 5 個分支：no route / quota-exhausted / time-filter / no-match / 正常
 *
 * 改動這個檔案時請務必跑 `npm test cron-items-mapper`。
 */
import { analyzeFlights, type TimeFilter } from './flights';
import type { Subscription, FlightQuote } from '@/types';
import type { MultiSubsItem } from './flex-message';

/** Cron 5a 階段對「一條路線（origin → city，可能多機場 fanout）」抓回的原始資料 */
export interface RouteData {
  fanout: Array<{
    airport: string;
    outbound: FlightQuote[];
    return: FlightQuote[];
    fromCache: boolean;
    queriedAt: string;
  }>;
  previousMins: { lcc: number | null; traditional: number | null };
  bestCachedAt: string | null;
  fromCacheAll: boolean;
}

/** 路線抓失敗時帶錯誤原因（給卡片區分「配額用完」vs「真的沒航班」）*/
export interface RouteError {
  error: 'quota-exhausted';
}

export type RouteOutcome = RouteData | RouteError;

/** type guard：區分成功 vs 錯誤 */
export function isRouteError(o: RouteOutcome | null | undefined): o is RouteError {
  return o != null && 'error' in o;
}

/**
 * 把一筆 Subscription + 對應的路線結果，組成卡片 item。
 * 套用該訂閱的時段窗口、跨機場挑最便宜（廉航 / 傳統各自）、算 vsPrev delta。
 *
 * 五種情境：
 *   1. route 不存在（cron 沒跑到這條） → cheapestPrice=null
 *   2. route 是 quota-exhausted 錯誤    → cheapestPrice=null, errorReason='quota-exhausted'
 *   3. 套時段窗口後 LCC/傳統都沒入選   → cheapestPrice=null (真的沒匹配)
 *   4. 只有 LCC                         → cheapestCategory='lcc'
 *   5. 只有傳統 / 兩者都有，傳統勝     → cheapestCategory='full-service'
 */
export function buildMultiSubsItem(
  sub: Subscription,
  route: RouteOutcome | null | undefined
): MultiSubsItem {
  const makeEmpty = (errorReason: 'quota-exhausted' | null = null): MultiSubsItem => ({
    origin: sub.origin,
    destination: sub.destination,
    outboundDate: sub.outbound_date ?? '',
    returnDate: sub.return_date ?? null,  // 單程訂閱 → null
    maxPrice: Number(sub.max_price),
    maxPriceTraditional: sub.max_price_traditional != null ? Number(sub.max_price_traditional) : null,
    label: sub.label,
    cheapestPrice: null,
    cheapestAirport: null,
    cheapestCategory: null,
    cheapestAirline: null,
    vsPrevPct: null,
    errorReason
  });

  if (!route) return makeEmpty();
  if (isRouteError(route)) return makeEmpty(route.error);

  // 套用這筆 sub 自己的時段窗口過濾（去/回 各自 min~max）
  const timeFilter: TimeFilter = {
    outboundMin: sub.outbound_min_departure_time ?? null,
    returnMin: sub.return_min_departure_time ?? null,
    outboundMax: sub.outbound_max_departure_time ?? null,
    returnMax: sub.return_max_departure_time ?? null
  };

  // 跨機場（東京 = HND + NRT 之類）挑各分類最便宜
  let bestLcc: { price: number; outboundAirline: string; returnAirline: string; airport: string; isEstimate: boolean } | null = null;
  let bestTrad: { price: number; airline: string; airport: string } | null = null;
  // 前 3 便宜航空：跨機場 merge，同航司留最低價（比照降價警報卡顯示前 3 家）
  const airlineMin = new Map<string, number>();
  for (const f of route.fanout) {
    const a = analyzeFlights(f.outbound, f.return, timeFilter, sub.airline_filter);
    if (a.lccCombo && (!bestLcc || a.lccCombo.price < bestLcc.price)) {
      bestLcc = { ...a.lccCombo, airport: f.airport };
    }
    if (a.traditionalRoundTrip && (!bestTrad || a.traditionalRoundTrip.price < bestTrad.price)) {
      bestTrad = { ...a.traditionalRoundTrip, airport: f.airport };
    }
    for (const t of a.topAirlines) {
      const prev = airlineMin.get(t.airline);
      if (prev == null || t.price < prev) airlineMin.set(t.airline, t.price);
    }
  }
  const topAirlines = [...airlineMin.entries()]
    .map(([airline, price]) => ({ airline, price }))
    .sort((x, y) => x.price - y.price)
    .slice(0, 3);

  // 兩類比一比挑勝出者當「卡片頂部那個價」
  let bestCheapest: { price: number; airline: string | null; airport: string; category: 'lcc' | 'full-service' } | null = null;
  if (bestLcc && (!bestTrad || bestLcc.price <= bestTrad.price)) {
    bestCheapest = { price: bestLcc.price, airline: bestLcc.outboundAirline, airport: bestLcc.airport, category: 'lcc' };
  } else if (bestTrad) {
    bestCheapest = { price: bestTrad.price, airline: bestTrad.airline, airport: bestTrad.airport, category: 'full-service' };
  }
  if (!bestCheapest) return makeEmpty();  // 真的沒匹配的航班（時段窗口或白名單過濾後 0 筆）

  // vsPrev delta 用未過濾的 previousMins 當基準（歷史 cache 沒存 raw flight 細節）
  // 啟用時段過濾後第一次 vsPrev 可能略偏，不影響邏輯正確性
  const lccVsPrevPct = (bestLcc && route.previousMins.lcc != null && route.previousMins.lcc > 0)
    ? Math.round(((bestLcc.price - route.previousMins.lcc) / route.previousMins.lcc) * 100)
    : null;
  const tradVsPrevPct = (bestTrad && route.previousMins.traditional != null && route.previousMins.traditional > 0)
    ? Math.round(((bestTrad.price - route.previousMins.traditional) / route.previousMins.traditional) * 100)
    : null;
  const vsPrev = bestCheapest.category === 'lcc' ? lccVsPrevPct : tradVsPrevPct;

  return {
    origin: sub.origin,
    destination: sub.destination,
    outboundDate: sub.outbound_date ?? '',
    returnDate: sub.return_date ?? null,  // 單程訂閱 → null
    maxPrice: Number(sub.max_price),
    maxPriceTraditional: sub.max_price_traditional != null ? Number(sub.max_price_traditional) : null,
    label: sub.label,
    cheapestPrice: bestCheapest.price,
    cheapestAirport: bestCheapest.airport,
    cheapestCategory: bestCheapest.category,
    cheapestAirline: bestCheapest.airline,
    vsPrevPct: vsPrev,
    topAirlines,
    lcc: bestLcc ? {
      price: bestLcc.price,
      airport: bestLcc.airport,
      outboundAirline: bestLcc.outboundAirline,
      returnAirline: bestLcc.returnAirline,
      vsPrevPct: lccVsPrevPct,
      isEstimate: bestLcc.isEstimate
    } : null,
    traditional: bestTrad ? {
      price: bestTrad.price,
      airport: bestTrad.airport,
      airline: bestTrad.airline,
      vsPrevPct: tradVsPrevPct
    } : null
  };
}

// ============================================================
// 開口式來回（0015）：一筆 = 兩段獨立單程，合併價 = 兩段最低相加
// ============================================================

/** 這筆訂閱是不是開口式（回程不同地點）？兩欄都有值才算。 */
export function isOpenJaw(
  sub: Pick<Subscription, 'return_origin' | 'return_destination'>
): boolean {
  return !!(sub.return_origin && sub.return_destination);
}

/** 單段（單程）分析：跨機場挑最低 + merge 前 3 航司。route 是該段的 one-way 查詢結果。 */
function analyzeOneWayLeg(
  route: RouteOutcome | null | undefined,
  timeFilter: TimeFilter,
  airlineFilter: string[] | null | undefined
): { price: number | null; airline: string | null; airport: string | null; topAirlines: { airline: string; price: number }[]; error: 'quota-exhausted' | null } {
  if (!route) return { price: null, airline: null, airport: null, topAirlines: [], error: null };
  if (isRouteError(route)) return { price: null, airline: null, airport: null, topAirlines: [], error: route.error };

  let best: { price: number; airline: string | null; airport: string } | null = null;
  const airlineMin = new Map<string, number>();
  for (const f of route.fanout) {
    // 單程 leg：return 必為空陣列 → analyzeFlights 用 cheapestOut 當該段最低
    const a = analyzeFlights(f.outbound, [], timeFilter, airlineFilter);
    if (a.cheapestRoundTripPrice != null && (!best || a.cheapestRoundTripPrice < best.price)) {
      best = { price: a.cheapestRoundTripPrice, airline: a.cheapestAirline, airport: f.airport };
    }
    for (const t of a.topAirlines) {
      const prev = airlineMin.get(t.airline);
      if (prev == null || t.price < prev) airlineMin.set(t.airline, t.price);
    }
  }
  const topAirlines = [...airlineMin.entries()]
    .map(([airline, price]) => ({ airline, price }))
    .sort((x, y) => x.price - y.price)
    .slice(0, 3);
  return { price: best?.price ?? null, airline: best?.airline ?? null, airport: best?.airport ?? null, topAirlines, error: null };
}

/**
 * 開口式 item：去段 + 回段各自單程分析，合併價 = 兩段相加（任一段沒料 → null）。
 *   legOut  = origin → destination          @ outbound_date 的單程查詢結果
 *   legBack = return_origin → return_destination @ return_date 的單程查詢結果
 * 去段套 outbound 時段窗口；回段是獨立單程，其出發時間存成 trip_leg=outbound，
 * 所以回段的 return_min/max 要對應到 outboundMin/Max 餵進 analyzeFlights。
 */
export function buildOpenJawItem(
  sub: Subscription,
  legOut: RouteOutcome | null | undefined,
  legBack: RouteOutcome | null | undefined
): MultiSubsItem {
  const outTf: TimeFilter = {
    outboundMin: sub.outbound_min_departure_time ?? null,
    outboundMax: sub.outbound_max_departure_time ?? null,
    returnMin: null, returnMax: null
  };
  const backTf: TimeFilter = {
    outboundMin: sub.return_min_departure_time ?? null,
    outboundMax: sub.return_max_departure_time ?? null,
    returnMin: null, returnMax: null
  };
  const out = analyzeOneWayLeg(legOut, outTf, sub.airline_filter);
  const back = analyzeOneWayLeg(legBack, backTf, sub.airline_filter);

  const combined = (out.price != null && back.price != null) ? out.price + back.price : null;
  const errorReason = (out.error || back.error) ? 'quota-exhausted' : null;

  return {
    origin: sub.origin,
    destination: sub.destination,
    outboundDate: sub.outbound_date ?? '',
    returnDate: sub.return_date ?? null,
    maxPrice: Number(sub.max_price),
    maxPriceTraditional: sub.max_price_traditional != null ? Number(sub.max_price_traditional) : null,
    label: sub.label,
    cheapestPrice: combined,
    cheapestAirport: out.airport,
    cheapestCategory: null,   // 開口式不縮成單一分類（兩段可能不同類）
    cheapestAirline: out.airline,
    vsPrevPct: null,          // 開口式先不算 vsPrev（兩段 baseline 複雜，後續再說）
    errorReason,
    openJaw: {
      out: { origin: sub.origin, destination: sub.destination, date: sub.outbound_date ?? '', price: out.price, airline: out.airline, airport: out.airport, topAirlines: out.topAirlines },
      back: { origin: sub.return_origin!, destination: sub.return_destination!, date: sub.return_date ?? '', price: back.price, airline: back.airline, airport: back.airport, topAirlines: back.topAirlines }
    }
  };
}
