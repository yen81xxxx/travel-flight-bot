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

  let cheapestRoundTrip: number | null = null;
  if (cheapestOut?.price != null && cheapestRet?.price != null) {
    cheapestRoundTrip = cheapestOut.price + cheapestRet.price;
  } else if (cheapestOut?.price != null && ret.length === 0) {
    // 如果是 SerpApi round-trip 直接給來回總價的情境
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
  if (analysis.cheapestOutbound) {
    const o = analysis.cheapestOutbound;
    lines.push('');
    lines.push(`【去程】${o.airline} NT$ ${(o.price ?? 0).toLocaleString()}`);
    if (o.duration_minutes) {
      lines.push(`  ⏱ ${formatDuration(o.duration_minutes)}　${o.stops === 0 ? '直飛' : `${o.stops} 次轉機`}`);
    }
  }
  if (analysis.cheapestReturn) {
    const r = analysis.cheapestReturn;
    lines.push(`【回程】${r.airline} NT$ ${(r.price ?? 0).toLocaleString()}`);
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
