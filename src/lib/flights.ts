import type { FlightQuote, SerpApiFlight } from '@/types';
import { getAirlineCategory } from '@/config/airlines';

/**
 * 起飛時段窗口 — 'HH:MM' 字串，去程 / 回程可獨立設定。
 * min = 不早於；max = 不晚於；任一端為 NULL 表該方向不限。
 */
export interface TimeFilter {
  outboundMin?: string | null;
  returnMin?: string | null;
  outboundMax?: string | null;
  returnMax?: string | null;
}

/**
 * 從 quote.raw 取出第一段（起點）的本地起飛時間「HH:MM」。
 * SerpApi 格式：'2026-02-04 06:25' → '06:25'。
 * 取不到 → null（呼叫端應該採「保留」策略，避免誤殺）。
 */
export function extractDepartureHHMM(q: FlightQuote): string | null {
  const raw = q.raw as SerpApiFlight | undefined;
  const time = raw?.flights?.[0]?.departure_airport?.time;
  if (typeof time !== 'string') return null;
  const m = time.match(/\b(\d{2}:\d{2})\b/);
  return m ? m[1] : null;
}

/**
 * 過濾起飛時間不在 [min, max] 窗口內的 quote。
 * - min 為 null → 不檢查下限
 * - max 為 null → 不檢查上限
 * - 兩者皆 null → 直接放行所有 quote
 * 'HH:MM' 字串字典序比較 == 數值比較（zero-padded 24h 格式特性）。
 * 取不到時間的 quote 一律保留（fail-open，避免 raw 缺欄位誤殺）。
 */
function filterByDepartureTime(
  quotes: FlightQuote[],
  minHHMM: string | null | undefined,
  maxHHMM: string | null | undefined
): FlightQuote[] {
  if (!minHHMM && !maxHHMM) return quotes;
  return quotes.filter(q => {
    const t = extractDepartureHHMM(q);
    if (t == null) return true;
    if (minHHMM && t < minHHMM) return false;
    if (maxHHMM && t > maxHHMM) return false;
    return true;
  });
}

/** 同一家航空公司來回（傳統航空優先這個組合） */
export interface SameAirlineRoundTrip {
  airline: string;
  price: number;
}

/** 去程 + 回程可以不同家的組合（廉航 mix-and-match） */
export interface MixedAirlineCombo {
  outboundAirline: string;
  returnAirline: string;
  price: number;
  /**
   * true 表示這個價格是「去程估算」而非「精確配對的來回總價」。
   * 發生在 return list 沒廉航資料時 (e.g. 首個 outbound 不是 LCC) 的 fallback。
   * UI 應該顯示「（估算）」提示使用者實際訂票可能差幾百元。
   */
  isEstimate: boolean;
}

export interface FlightAnalysis {
  cheapestOutbound: FlightQuote | null;
  cheapestReturn: FlightQuote | null;
  cheapestRoundTripPrice: number | null;
  cheapestAirline: string | null;
  /**
   * 傳統航空（星宇/長榮）同家來回最低價。
   * 用 outbound 的估算（Google Flights 對該航司同家來回的估算），不需多打 API。
   */
  traditionalRoundTrip: SameAirlineRoundTrip | null;
  /**
   * 廉航（虎航/捷星/酷航）去 + 回最便宜組合（可不同家）。
   * - 有 return list 時：從 return list 抓最便宜回程 + 它對應的去程（serpapi 已用最便宜廉航 outbound 的 token 查）
   * - 沒有 return list 時：fallback 到「最便宜廉航 outbound」同家來回估算
   */
  lccCombo: MixedAirlineCombo | null;
  outboundCount: number;
  returnCount: number;
}

/**
 * 整合 N8N「建立 HTML」節點裡的分析邏輯：
 * - 找最便宜去程
 * - 找最便宜回程
 * - 算最便宜往返組合
 * - 找最便宜的航空公司
 */
export function analyzeFlights(
  outbound: FlightQuote[],
  ret: FlightQuote[],
  timeFilter?: TimeFilter
): FlightAnalysis {
  // 起飛時段窗口過濾：套用後再排序找最便宜
  const fOutbound = filterByDepartureTime(outbound, timeFilter?.outboundMin, timeFilter?.outboundMax);
  const fReturn = filterByDepartureTime(ret, timeFilter?.returnMin, timeFilter?.returnMax);

  const sortedOut = [...fOutbound].sort(byPriceAsc);
  const sortedRet = [...fReturn].sort(byPriceAsc);

  const cheapestOut = sortedOut[0] ?? null;
  const cheapestRet = sortedRet[0] ?? null;

  // ⚠️ SerpApi 的 Google Flights round-trip：outbound 和 return 結果的 price 都已經是「來回總價」
  // （outbound 是估計值、return 是該 outbound+return 配對的精確值）
  // 過去的版本曾經誤把兩個相加，會讓價格變成實際的 2 倍。
  //
  // 正確邏輯：
  //  - 有 return 結果 → 用 cheapestRet.price（含 outbound 配對的精確來回總價）
  //  - 沒有 return 結果（單程或拿不到 departure_token）→ 用 cheapestOut.price（已是估計來回總價）
  let cheapestRoundTrip: number | null = null;
  if (cheapestRet?.price != null) {
    cheapestRoundTrip = cheapestRet.price;
  } else if (cheapestOut?.price != null) {
    cheapestRoundTrip = cheapestOut.price;
  }

  const cheapestAirline = cheapestOut?.airline ?? null;

  return {
    cheapestOutbound: cheapestOut,
    cheapestReturn: cheapestRet,
    cheapestRoundTripPrice: cheapestRoundTrip,
    cheapestAirline,
    traditionalRoundTrip: pickTraditionalSameAirline(fOutbound),
    lccCombo: pickLccCombo(fOutbound, fReturn),
    outboundCount: fOutbound.length,
    returnCount: fReturn.length
  };
}

/**
 * 傳統航空：從 outbound 列表分別找最便宜的星宇 / 長榮估算，選低的回傳。
 * outbound[i].price 是 Google Flights 對「該家航司同家來回」的估算總價，所以這天然就是同家來回。
 */
function pickTraditionalSameAirline(outbound: FlightQuote[]): SameAirlineRoundTrip | null {
  let best: FlightQuote | null = null;
  for (const q of outbound) {
    if (q.price == null || !q.airline) continue;
    if (getAirlineCategory(q.airline) !== 'full-service') continue;
    if (best == null || (q.price < (best.price ?? Number.POSITIVE_INFINITY))) best = q;
  }
  if (!best || best.price == null || !best.airline) return null;
  return { airline: best.airline, price: best.price };
}

/**
 * 廉航混搭：
 * - 拿「最便宜的廉航 outbound」當去程（airline X）
 * - 從 return list 抓「最便宜的廉航回程」當回程（airline Y，可能 ≠ X）
 * - 價格用 return list 那筆的 price（已是 X 去 + Y 回的精確來回總價）
 *
 * 若 return list 沒有廉航回程（例如 SerpApi 沒回傳混搭選項），fallback 到去程同家估算。
 */
function pickLccCombo(outbound: FlightQuote[], ret: FlightQuote[]): MixedAirlineCombo | null {
  const cheapestLccOut = pickCheapestLcc(outbound);
  if (!cheapestLccOut) return null;

  const cheapestLccRet = pickCheapestLcc(ret);
  if (cheapestLccRet && cheapestLccRet.price != null && cheapestLccRet.airline) {
    // 精確：return list 已是「LCC 去 + LCC 回」配對的精確來回總價
    return {
      outboundAirline: cheapestLccOut.airline!,
      returnAirline: cheapestLccRet.airline,
      price: cheapestLccRet.price,
      isEstimate: false
    };
  }

  // fallback：沒有廉航回程資料 → 用去程的估算（同家來回）；標 isEstimate=true
  return {
    outboundAirline: cheapestLccOut.airline!,
    returnAirline: cheapestLccOut.airline!,
    price: cheapestLccOut.price!,
    isEstimate: true
  };
}

function pickCheapestLcc(quotes: FlightQuote[]): FlightQuote | null {
  let best: FlightQuote | null = null;
  for (const q of quotes) {
    if (q.price == null || !q.airline) continue;
    if (getAirlineCategory(q.airline) !== 'lcc') continue;
    if (best == null || (q.price < (best.price ?? Number.POSITIVE_INFINITY))) best = q;
  }
  return best;
}

function byPriceAsc(a: FlightQuote, b: FlightQuote): number {
  const pa = a.price ?? Number.POSITIVE_INFINITY;
  const pb = b.price ?? Number.POSITIVE_INFINITY;
  return pa - pb;
}

/**
 * 格式化單一航班段（去程或回程）
 */
function formatLegLine(legLabel: string, flight: FlightQuote): string[] {
  const legLines: string[] = [];
  legLines.push(`【${legLabel}】${flight.airline ?? '—'}`);
  if (flight.duration_minutes) {
    const stops = flight.stops === 0 ? '直飛' : `${flight.stops} 次轉機`;
    legLines.push(`  ⏱ ${formatDuration(flight.duration_minutes)}　${stops}`);
  }
  return legLines;
}

/**
 * 把分析結果轉成簡短的 LINE 訊息文字（純文字版）。
 */
export function formatAnalysisForLine(
  analysis: FlightAnalysis,
  outboundDate: string,
  returnDate: string | undefined,  // undefined = 單程
  origin: string,
  destination: string
): string {
  const lines: string[] = [];
  lines.push(`✈️ ${origin} → ${destination}`);
  lines.push(returnDate ? `📅 ${outboundDate} ~ ${returnDate}` : `📅 單程 ${outboundDate}`);
  lines.push('');

  if (analysis.outboundCount === 0) {
    lines.push('❌ 找不到符合條件的航班（星宇/長榮/捷星/酷航）');
    return lines.join('\n');
  }

  if (analysis.cheapestRoundTripPrice != null) {
    lines.push(`💰 最便宜${returnDate ? '往返' : '單程'}：NT$ ${analysis.cheapestRoundTripPrice.toLocaleString()}`);
  }
  if (analysis.cheapestAirline) {
    lines.push(`🏢 主推航空：${analysis.cheapestAirline}`);
  }
  // 註：outbound 和 return 的 price 都是「來回總價」(SerpApi/Google Flights 規格)，
  // 所以個別 leg 不再顯示金額，避免誤導
  if (analysis.cheapestOutbound) {
    lines.push('');
    lines.push(...formatLegLine('去程', analysis.cheapestOutbound));
  }
  if (analysis.cheapestReturn) {
    lines.push(...formatLegLine('回程', analysis.cheapestReturn));
  }

  return lines.join('\n');
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m > 0 ? `${m}m` : ''}`;
}
