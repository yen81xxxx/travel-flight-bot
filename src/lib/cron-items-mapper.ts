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
  // 每家航空跨機場(fanout)留最便宜那筆（連同出發/抵達時間，給通報卡片標）
  const airlineMin = new Map<string, { price: number; depTime: string | null; arrTime: string | null }>();
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
      if (prev == null || t.price < prev.price) {
        airlineMin.set(t.airline, { price: t.price, depTime: t.depTime ?? null, arrTime: t.arrTime ?? null });
      }
    }
  }
  const topAirlines = [...airlineMin.entries()]
    .map(([airline, v]) => ({ airline, price: v.price, depTime: v.depTime, arrTime: v.arrTime }))
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
// 開口式來回（0015 → multi-city）：一筆 = 一張多城市票，cheapestPrice = 整程總價
// ============================================================

/** 這筆訂閱是不是開口式（回程不同地點）？兩欄都有值才算。 */
export function isOpenJaw(
  sub: Pick<Subscription, 'return_origin' | 'return_destination'>
): boolean {
  return !!(sub.return_origin && sub.return_destination);
}

/** searchMultiCity 結果餵進 buildOpenJawItem 的形狀（保持 mapper 純函數、不 import serpapi）*/
export interface OpenJawSearchResult {
  cheapestTotal: number | null;
  airline: string | null;
  error?: 'quota-exhausted' | null;
}

/**
 * 開口式 item（multi-city 一張票）：cheapestPrice = 整程最低總價（searchMultiCity 回的）。
 * 沒料 → null；配額用光 → errorReason='quota-exhausted'。
 * 開口式是一張票 → 沒有 lcc/traditional 分類、沒有各段單獨價、vsPrev 先不算。
 */
export function buildOpenJawItem(
  sub: Subscription,
  result: OpenJawSearchResult | null | undefined
): MultiSubsItem {
  const total = result?.cheapestTotal ?? null;
  const airline = result?.airline ?? null;
  const errorReason = result?.error === 'quota-exhausted' ? 'quota-exhausted' : null;

  // 釘選組合 → 從 pinned_flight_labels 抓去/回起飛時間，給通報卡片標出來。
  // labels 形如 ['去 長榮航空 15:20', '回 長榮航空 12:15']；沒釘 → 兩個都 null。
  // 開口式整程價就是這個釘選組合的價 → 標釘選時間跟價格一致、不會誤導。
  const labels = sub.pinned_flight_labels;
  const outTime = pinnedLabelTime(labels?.[0]);
  const backTime = pinnedLabelTime(labels?.[1]);

  return {
    origin: sub.origin,
    destination: sub.destination,
    outboundDate: sub.outbound_date ?? '',
    returnDate: sub.return_date ?? null,
    maxPrice: Number(sub.max_price),
    maxPriceTraditional: sub.max_price_traditional != null ? Number(sub.max_price_traditional) : null,
    label: sub.label,
    cheapestPrice: total,
    cheapestAirport: null,
    cheapestCategory: null,
    cheapestAirline: airline,
    vsPrevPct: null,
    errorReason,
    openJaw: {
      out: { origin: sub.origin, destination: sub.destination, date: sub.outbound_date ?? '', time: outTime },
      back: { origin: sub.return_origin!, destination: sub.return_destination!, date: sub.return_date ?? '', time: backTime },
      airline
    }
  };
}

/** 從釘選 label 尾端抓 'HH:MM' 起飛時間；沒有 → null。 */
function pinnedLabelTime(label: string | undefined | null): string | null {
  if (!label) return null;
  const m = label.match(/(\d{1,2}:\d{2})\s*$/);
  return m ? m[1] : null;
}
