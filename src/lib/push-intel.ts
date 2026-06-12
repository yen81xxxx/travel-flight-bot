/**
 * push-intel — 推播當下算 Price Intelligence（verdict parity 的關鍵）
 *
 * LINE_SURFACE_SPEC §E 第一條：「Push verdict == LIFF verdict for the same
 * watch (same priceIntel)」。LIFF 的 verdict 由 with-quotes 的 quote-builder
 * 呼叫 computePriceIntel 算；推播這邊**用同一顆引擎、同樣的 30 天每日最低
 * 資料**算，永遠不會跟 app 打架。
 *
 * 跟 with-quotes route 的差別：sub-checker 推播時「現價」已經在手上
 * （剛跑完 SerpApi + analyzeFlights），所以只需要補 2 條 query：
 *   - 過去 30 天 flight_quotes → 每日最低 → history
 *   - 7 天前 ±1 天最低 → weekly deltaPct
 *
 * Query 失敗 → 全部降級 null（推播照發、只是卡片少 verdict badge 跟 delta）。
 * 推播不能因為 intel 掛了而不發 — 那是主要功能。
 */
import { getCityAirports } from '@/config/airports';
import { computePriceIntel, type PriceIntel } from '@/app/liff/_lib/priceIntel';
// 跟 LIFF 同一份 daysUntil 實作 — 自己重寫第二份語意會飄（off-by-one → verdict 文案不同步）
import { computeDaysUntil } from '@/app/api/subscriptions/with-quotes/quote-builder';
import type { PricePoint } from '@/app/liff/_types';
import type { Subscription } from '@/types';

const ONE_DAY = 24 * 60 * 60 * 1000;

export interface PushIntelResult {
  /** null = 撈不到歷史（query 失敗）— 跟 'building' 不同：building 是資料不足 */
  intel: PriceIntel | null;
  /** 週變化 %（同 quote-builder computeDeltaPct 規則）；null = 沒得比 */
  deltaPct: number | null;
  /** 30 天每日最低價（升冪）— flex 卡 mini bars 用 */
  dailyMins: number[];
}

/** rows → 每日最低（升冪日期）。跟 with-quotes route 的 byDay 邏輯一致。 */
export function rowsToDailyMins(
  rows: { queried_at: string; price: number | null }[]
): { date: string; minPrice: number }[] {
  const byDay = new Map<string, number>();
  for (const r of rows) {
    if (r.price == null) continue;
    const day = r.queried_at.slice(0, 10);
    const cur = byDay.get(day);
    if (cur == null || r.price < cur) byDay.set(day, r.price);
  }
  return Array.from(byDay.entries())
    .map(([date, minPrice]) => ({ date, minPrice }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * 純函數核心 — query 結果進、intel 出。抽出來單測（mock supabase 太重）。
 */
export function buildPushIntel(
  historyRows: { queried_at: string; price: number | null }[],
  weekAgoRows: { price: number | null }[],
  currentPrice: number,
  threshold: number,
  outboundDate: string | null | undefined
): PushIntelResult {
  const daily = rowsToDailyMins(historyRows);
  // history 的 d 標籤只給 LIFF 圖表顯示用，verdict 計算只看 p — 這裡用 'M/D' 簡式
  const history: PricePoint[] = daily.map(x => {
    const [, m, d] = x.date.split('-');
    return { d: `${parseInt(m, 10)}/${parseInt(d, 10)}`, p: x.minPrice };
  });

  let weekAgoMin: number | null = null;
  for (const r of weekAgoRows) {
    if (r.price == null) continue;
    if (weekAgoMin == null || r.price < weekAgoMin) weekAgoMin = r.price;
  }
  const deltaPct = weekAgoMin != null && weekAgoMin > 0
    ? Math.round(((currentPrice - weekAgoMin) / weekAgoMin) * 1000) / 10
    : null;

  const intel = computePriceIntel(history, currentPrice, threshold, computeDaysUntil(outboundDate), deltaPct);
  return { intel, deltaPct, dailyMins: daily.map(x => x.minPrice) };
}

/**
 * 撈 DB + 算 intel。任何 query 失敗 → 安全降級（intel: null）不丟例外。
 */
export async function fetchPushIntel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sub: Subscription,
  currentPrice: number
): Promise<PushIntelResult> {
  try {
    const destinations = getCityAirports(sub.destination);
    const now = Date.now();
    const historySince = new Date(now - 30 * ONE_DAY).toISOString();
    const weekAgoStart = new Date(now - 8 * ONE_DAY).toISOString();
    const weekAgoEnd = new Date(now - 6 * ONE_DAY).toISOString();

    // 同 with-quotes route 的 baseFilter 條件 — 兩邊看同一池資料才有 parity
    const baseFilter = (q: ReturnType<typeof supabase['from']>) => {
      let qq = q
        .eq('origin', sub.origin)
        .in('destination', destinations)
        .eq('outbound_date', sub.outbound_date)
        .eq('stops', 0)
        .not('price', 'is', null);
      qq = sub.return_date == null ? qq.is('return_date', null) : qq.eq('return_date', sub.return_date);
      return qq;
    };

    const [historyRes, weekRes] = await Promise.all([
      baseFilter(supabase.from('flight_quotes').select('queried_at, price'))
        .gte('queried_at', historySince),
      baseFilter(supabase.from('flight_quotes').select('price'))
        .gte('queried_at', weekAgoStart)
        .lt('queried_at', weekAgoEnd)
    ]);
    if (historyRes.error) throw new Error(historyRes.error.message);

    return buildPushIntel(
      (historyRes.data ?? []) as { queried_at: string; price: number | null }[],
      (weekRes.error ? [] : (weekRes.data ?? [])) as { price: number | null }[],
      currentPrice,
      Number(sub.max_price),
      sub.outbound_date
    );
  } catch (e) {
    console.warn('[push-intel] degraded (no verdict on push card):', e instanceof Error ? e.message : e);
    return { intel: null, deltaPct: null, dailyMins: [] };
  }
}
