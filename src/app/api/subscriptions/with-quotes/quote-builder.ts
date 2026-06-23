/**
 * 純函數：把「DB 撈回的原始資料」轉成 WatchQuote。
 *
 * 抽出來不混進 route.ts 的理由：
 *   - route handler 跟 Supabase / NextRequest 耦合，jest 環境裝起來很重
 *   - 本邏輯有 4 個分支（無報價 / 沒 LCC / 沒傳統 / 兩者都有）+ 3 個降級
 *     (deltaPct null / history 空 / 兩者都空)，純函數測比較紮實
 *   - 跟 cron-items-mapper 同一個模式 — 拿同樣的 analyzeFlights 跑跨機場挑最低
 *
 * 對應 design_handoff_travl_vision/API_CONTRACT.md「Field sources」表：
 *   currentBest/lcc/trad ← analyzeFlights × fanout × max-by-price
 *   deltaPct             ← 即時算 (currentBest - weekAgoMin) / weekAgoMin
 *   history              ← 過去 30/90 天每日 minPrice，'YYYY-MM-DD' → 'M/D'
 */
import { analyzeFlights, type TimeFilter } from '@/lib/flights';
import { getAirlineCategory } from '@/config/airlines';
import type { FlightQuote, Subscription } from '@/types';
import type { WatchQuote, PricePoint } from '@/app/liff/_types';
import { computePriceIntel } from '@/app/liff/_lib/priceIntel';

/** 每個機場 (fanout) 的 outbound+return 兩堆 flight 報價 */
export interface AirportFlights {
  outbound: FlightQuote[];
  return: FlightQuote[];
}

/** Builder input — route.ts 撈完 DB 後填好這包傳進來 */
export interface QuoteSourceData {
  /** 過去 6h 內、按 fanout airport 分組的報價（東京 = HND + NRT 之類） */
  recentByAirport: Map<string, AirportFlights>;
  /** 7 天前 ±1 天的最低價（不分類）— 算 deltaPct 用 */
  weekAgoMin: number | null;
  /** 過去 30/90 天每日最低價（升冪日期），date 是 'YYYY-MM-DD' */
  daily: { date: string; minPrice: number }[];
}

/**
 * date 'YYYY-MM-DD' → 'M/D' (e.g. '2026-06-08' → '6/8')
 * 不用 Date()/timezone 解析 — 純字串切，避免時區把 6/8 算成 6/7
 */
export function formatShortDate(yyyymmdd: string): string {
  const [, m, d] = yyyymmdd.split('-');
  if (!m || !d) return yyyymmdd; // 防壞資料；不 throw
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

/**
 * 把 daily array 轉成 PricePoint[] — date → 'M/D' 短標
 */
export function dailyToHistory(daily: { date: string; minPrice: number }[]): PricePoint[] {
  return daily.map(p => ({ d: formatShortDate(p.date), p: p.minPrice }));
}

/**
 * 算 deltaPct — (currentBest - weekAgoMin) / weekAgoMin × 100，四捨五入到 1 位小數
 * 沒有 weekAgoMin / weekAgoMin <= 0 → null（前端會藏 delta chip）
 */
export function computeDeltaPct(currentBest: number, weekAgoMin: number | null): number | null {
  if (weekAgoMin == null || weekAgoMin <= 0) return null;
  const pct = ((currentBest - weekAgoMin) / weekAgoMin) * 100;
  // 1 位小數 — 卡片上顯示「↓6.2%」這種精度，避免 ↓6.234567%
  return Math.round(pct * 10) / 10;
}

/**
 * 主 builder：純函數，輸入 sub + DB 撈回的料，輸出 WatchQuote 或 null
 *
 * Return null 的條件：所有機場跑完 analyzeFlights 都拿不到任何報價
 *   (lccCombo == null && traditionalRoundTrip == null) — frontend 接 null
 *   就降級顯示「監控中」+ 目標價（README §6 graceful degradation）
 *
 * deltaPct / history 缺資料時用 null / [] — 不拋例外，讓 quote 仍然算出來
 */
export function buildWatchQuote(
  sub: Subscription,
  src: QuoteSourceData
): WatchQuote | null {
  const timeFilter: TimeFilter = {
    outboundMin: sub.outbound_min_departure_time ?? null,
    returnMin: sub.return_min_departure_time ?? null,
    outboundMax: sub.outbound_max_departure_time ?? null,
    returnMax: sub.return_max_departure_time ?? null
  };

  // 釘選特定航班（方案 B）：只追那一班，currentBest = 那班價格。找不到 → null（監控中）。
  if (sub.pinned_flight_number) {
    let pinnedPrice: number | null = null;
    let pinnedAirline: string | null = null;
    for (const [, flights] of src.recentByAirport) {
      const a = analyzeFlights(flights.outbound, flights.return, timeFilter, sub.airline_filter, sub.pinned_flight_number);
      if (a.cheapestRoundTripPrice != null && (pinnedPrice == null || a.cheapestRoundTripPrice < pinnedPrice)) {
        pinnedPrice = a.cheapestRoundTripPrice;
        pinnedAirline = a.cheapestAirline;
      }
    }
    if (pinnedPrice == null) return null;  // 那班暫無報價 → 前端降級「監控中」
    const currentType: 'lcc' | 'trad' = getAirlineCategory(pinnedAirline) === 'lcc' ? 'lcc' : 'trad';
    const label = sub.pinned_flight_label ?? pinnedAirline ?? '—';
    const deltaPct = computeDeltaPct(pinnedPrice, src.weekAgoMin);
    const history = dailyToHistory(src.daily);
    const intel = computePriceIntel(history, pinnedPrice, Number(sub.max_price), computeDaysUntil(sub.outbound_date), deltaPct);
    return {
      currentBest: pinnedPrice,
      currentType,
      lcc: currentType === 'lcc' ? { price: pinnedPrice, out: label, ret: null, estimate: false } : null,
      trad: currentType === 'trad' ? { price: pinnedPrice, airline: label } : null,
      deltaPct,
      history,
      intel
    };
  }

  // 跨機場挑最便宜（cron-items-mapper 邏輯）
  let bestLcc: { price: number; out: string; ret: string | null; estimate: boolean } | null = null;
  let bestTrad: { price: number; airline: string } | null = null;

  for (const [, flights] of src.recentByAirport) {
    const a = analyzeFlights(flights.outbound, flights.return, timeFilter, sub.airline_filter, sub.pinned_flight_number);
    if (a.lccCombo && (!bestLcc || a.lccCombo.price < bestLcc.price)) {
      bestLcc = {
        price: a.lccCombo.price,
        out: a.lccCombo.outboundAirline,
        // 單程訂閱沒回程 → returnAirline 可能 = outboundAirline (analyzeFlights 邏輯)，但用 null 比較語意正確
        ret: sub.return_date == null ? null : a.lccCombo.returnAirline,
        estimate: a.lccCombo.isEstimate
      };
    }
    if (a.traditionalRoundTrip && (!bestTrad || a.traditionalRoundTrip.price < bestTrad.price)) {
      bestTrad = {
        price: a.traditionalRoundTrip.price,
        airline: a.traditionalRoundTrip.airline
      };
    }
  }

  // 全機場都沒料 → null，frontend 降級成「目標價 + 監控中」
  if (!bestLcc && !bestTrad) return null;

  // currentBest = 兩類中較便宜的；同價時優先 LCC（手冊範例 currentType='lcc' 為 default）
  let currentBest: number;
  let currentType: 'lcc' | 'trad';
  if (bestLcc && (!bestTrad || bestLcc.price <= bestTrad.price)) {
    currentBest = bestLcc.price;
    currentType = 'lcc';
  } else {
    // 此分支等同 bestTrad != null（前面 if 過濾掉 bestLcc==null && bestTrad==null）
    currentBest = bestTrad!.price;
    currentType = 'trad';
  }

  const deltaPct = computeDeltaPct(currentBest, src.weekAgoMin);
  const history = dailyToHistory(src.daily);

  // === PR #5: Price Intelligence — server-side 算好附在 quote 一起回 ===
  // 集中算的好處：
  //   1. 同樣的結果可以拿去做 push copy (cron / sub-checker 不用各自重寫)
  //   2. 客戶端不用算統計，省 CPU
  //   3. 邏輯只有一份，trust 的關鍵
  const daysUntilDeparture = computeDaysUntil(sub.outbound_date);
  const intel = computePriceIntel(history, currentBest, Number(sub.max_price), daysUntilDeparture, deltaPct);

  return {
    currentBest,
    currentType,
    lcc: bestLcc,
    trad: bestTrad,
    deltaPct,
    history,
    intel
  };
}

/**
 * 從 outbound_date 算還剩幾天。null / 壞日期 → null（前端會跳過 days reason）。
 * 純字串切，不靠 Date 解析 → 避免 UTC vs local 時區把今天算成明天。
 */
export function computeDaysUntil(yyyymmdd: string | null | undefined): number | null {
  if (!yyyymmdd) return null;
  const parts = yyyymmdd.split('-').map(p => parseInt(p, 10));
  if (parts.length !== 3 || parts.some(isNaN)) return null;
  const target = Date.UTC(parts[0], parts[1] - 1, parts[2]);
  const today = new Date();
  const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((target - todayUTC) / 86400000);
}
