import type { FlightQuote } from '@/types';

export interface FlightAnalysis {
  cheapestOutbound: FlightQuote | null;
  cheapestReturn: FlightQuote | null;
  cheapestRoundTripPrice: number | null;
  cheapestAirline: string | null;
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
  ret: FlightQuote[]
): FlightAnalysis {
  const sortedOut = [...outbound].sort(byPriceAsc);
  const sortedRet = [...ret].sort(byPriceAsc);

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
    outboundCount: outbound.length,
    returnCount: ret.length
  };
}

function byPriceAsc(a: FlightQuote, b: FlightQuote): number {
  const pa = a.price ?? Number.POSITIVE_INFINITY;
  const pb = b.price ?? Number.POSITIVE_INFINITY;
  return pa - pb;
}

/**
 * 把分析結果轉成簡短的 LINE 訊息文字（純文字版）。
 */
export function formatAnalysisForLine(
  analysis: FlightAnalysis,
  outboundDate: string,
  returnDate: string,
  origin: string,
  destination: string
): string {
  const lines: string[] = [];
  lines.push(`✈️ ${origin} → ${destination}`);
  lines.push(`📅 ${outboundDate} ~ ${returnDate}`);
  lines.push('');

  if (analysis.outboundCount === 0) {
    lines.push('❌ 找不到符合條件的航班（星宇/長榮/虎航/捷星/酷航）');
    return lines.join('\n');
  }

  if (analysis.cheapestRoundTripPrice != null) {
    lines.push(`💰 最便宜往返：NT$ ${analysis.cheapestRoundTripPrice.toLocaleString()}`);
  }
  if (analysis.cheapestAirline) {
    lines.push(`🏢 主推航空：${analysis.cheapestAirline}`);
  }
  // 註：outbound 和 return 的 price 都是「來回總價」(SerpApi/Google Flights 規格)，
  // 所以個別 leg 不再顯示金額，避免誤導
  if (analysis.cheapestOutbound) {
    const o = analysis.cheapestOutbound;
    lines.push('');
    lines.push(`【去程】${o.airline ?? '—'}`);
    if (o.duration_minutes) {
      lines.push(`  ⏱ ${formatDuration(o.duration_minutes)}　${o.stops === 0 ? '直飛' : `${o.stops} 次轉機`}`);
    }
  }
  if (analysis.cheapestReturn) {
    const r = analysis.cheapestReturn;
    lines.push(`【回程】${r.airline ?? '—'}`);
    if (r.duration_minutes) {
      lines.push(`  ⏱ ${formatDuration(r.duration_minutes)}　${r.stops === 0 ? '直飛' : `${r.stops} 次轉機`}`);
    }
  }

  return lines.join('\n');
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}h${m > 0 ? `${m}m` : ''}`;
}
