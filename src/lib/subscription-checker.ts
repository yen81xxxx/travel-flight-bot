import { getSupabase } from './supabase';
import { searchFlights } from './serpapi';
import { analyzeFlights } from './flights';
import { pushText } from './line';
import { formatAirport } from '@/config/airports';
import type { Subscription } from '@/types';

const NOTIFY_COOLDOWN_HOURS = 12; // 同一訂閱 12 小時內最多通知一次

interface CheckResult {
  total: number;
  notified: number;
  skipped: number;
  errors: number;
}

/**
 * 跑過所有 active 訂閱，逐一搜尋並比對價格門檻。
 * 跌破門檻就 push LINE 訊息並更新 last_notified。
 */
export async function checkAllSubscriptions(): Promise<CheckResult> {
  const supabase = getSupabase();
  const result: CheckResult = { total: 0, notified: 0, skipped: 0, errors: 0 };

  const { data: subs, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('active', true);

  if (error) {
    console.error('[sub-checker] read subs failed:', error);
    return result;
  }

  result.total = subs?.length ?? 0;
  const cooldownMs = NOTIFY_COOLDOWN_HOURS * 3600 * 1000;
  const now = Date.now();

  for (const sub of (subs ?? []) as Subscription[]) {
    try {
      // 冷卻期判斷
      if (
        sub.last_notified_at &&
        now - new Date(sub.last_notified_at).getTime() < cooldownMs
      ) {
        result.skipped++;
        continue;
      }

      // 決定查詢日期：訂閱有指定就用，沒有就用未來 30 天 + 4 晚
      const outboundDate =
        sub.outbound_date ?? defaultDate(30);
      const returnDate =
        sub.return_date ?? defaultDate(34);

      const search = await searchFlights({
        origin: sub.origin,
        destination: sub.destination,
        outboundDate,
        returnDate
      });
      const analysis = analyzeFlights(search.outbound, search.return);
      const cheapest = analysis.cheapestRoundTripPrice;

      if (cheapest != null && cheapest <= Number(sub.max_price)) {
        await pushText(sub.source_id, formatAlertMessage(sub, analysis, outboundDate, returnDate));
        await supabase
          .from('subscriptions')
          .update({
            last_notified_at: new Date().toISOString(),
            last_notified_price: cheapest
          })
          .eq('id', sub.id);
        await supabase
          .from('notifications')
          .insert({
            subscription_id: sub.id,
            source_id: sub.source_id,
            price_at_notify: cheapest,
            message: '降價提醒已發送'
          });
        result.notified++;
      }
    } catch (err) {
      console.error('[sub-checker] sub', sub.id, 'failed:', err);
      result.errors++;
    }
  }

  return result;
}

function defaultDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}

function formatAlertMessage(
  sub: Subscription,
  analysis: ReturnType<typeof analyzeFlights>,
  outboundDate: string,
  returnDate: string
): string {
  const lines = [
    '🔔 降價通知！',
    '',
    `✈️ ${formatAirport(sub.origin)} → ${formatAirport(sub.destination)}`,
    `📅 ${outboundDate} ~ ${returnDate}`,
    '',
    `💰 目前最便宜往返：NT$ ${analysis.cheapestRoundTripPrice?.toLocaleString()}`,
    `🎯 你設定的門檻：NT$ ${Number(sub.max_price).toLocaleString()}`
  ];
  if (analysis.cheapestAirline) {
    lines.push(`🏢 主推航空：${analysis.cheapestAirline}`);
  }
  lines.push('', '輸入「我的訂閱」可管理通知設定');
  return lines.join('\n');
}
