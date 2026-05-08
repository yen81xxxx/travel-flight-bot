import { getSupabase } from './supabase';
import { searchFlights } from './serpapi';
import { analyzeFlights } from './flights';
import { pushText } from './line';
import { buildAlertFlex } from './flex-message';
import { messagingApi } from '@line/bot-sdk';
import { getLineClient } from './line';
import { formatAirport } from '@/config/airports';
import type { Subscription } from '@/types';

interface CheckResult {
  total: number;
  notified: number;
  skipped: number;
  errors: number;
  serpapiCalls: number;
}

/**
 * 跑過所有 active 訂閱，逐一搜尋並比對價格門檻。
 * 通知條件（兩者皆需滿足）：
 *   1. 當前最低價 <= 門檻
 *   2. 從未通知過 OR 當前價比上次通知再低 5%
 * 同 (origin, destination, outbound_date, return_date) 的多筆訂閱共用一次查詢。
 */
export async function checkAllSubscriptions(): Promise<CheckResult> {
  const supabase = getSupabase();
  const result: CheckResult = { total: 0, notified: 0, skipped: 0, errors: 0, serpapiCalls: 0 };

  const { data: subs, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('active', true);

  if (error) {
    console.error('[sub-checker] read subs failed:', error);
    return result;
  }

  const allSubs = (subs ?? []) as Subscription[];
  result.total = allSubs.length;

  // 依 (origin, destination, outbound_date, return_date) 分組合併查詢
  const groups = new Map<string, Subscription[]>();
  for (const sub of allSubs) {
    const key = [
      sub.origin,
      sub.destination,
      sub.outbound_date ?? defaultDate(30),
      sub.return_date ?? defaultDate(34)
    ].join('|');
    const arr = groups.get(key) ?? [];
    arr.push(sub);
    groups.set(key, arr);
  }

  for (const [key, subList] of groups) {
    const [origin, destination, outboundDate, returnDate] = key.split('|');
    try {
      const search = await searchFlights({
        origin,
        destination,
        outboundDate,
        returnDate
      });
      result.serpapiCalls += search.serpapiCalls;
      const analysis = analyzeFlights(search.outbound, search.return);
      const cheapest = analysis.cheapestRoundTripPrice;

      if (cheapest == null) continue;

      // 同組訂閱依 max_price 排序，逐一檢查是否該通知
      for (const sub of subList) {
        try {
          if (cheapest > Number(sub.max_price)) {
            result.skipped++;
            continue;
          }

          // 已通知過：要比上次通知價再低至少 5% 才再通知（避免重複轟炸）
          const lastPrice = sub.last_notified_price != null
            ? Number(sub.last_notified_price)
            : null;
          if (lastPrice != null && cheapest > lastPrice * 0.95) {
            result.skipped++;
            continue;
          }

          // 同一筆訂閱 24 小時內不重複通知
          const cooldownMs = 24 * 3600 * 1000;
          if (
            sub.last_notified_at &&
            Date.now() - new Date(sub.last_notified_at).getTime() < cooldownMs
          ) {
            result.skipped++;
            continue;
          }

          await sendAlert(sub, analysis, outboundDate, returnDate);
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
              message: '降價提醒'
            });
          result.notified++;
        } catch (err) {
          console.error('[sub-checker] sub', sub.id, 'failed:', err);
          result.errors++;
        }
      }
    } catch (err) {
      console.error('[sub-checker] group', key, 'failed:', err);
      result.errors += subList.length;
    }
  }

  return result;
}

async function sendAlert(
  sub: Subscription,
  analysis: ReturnType<typeof analyzeFlights>,
  outboundDate: string,
  returnDate: string
): Promise<void> {
  const cheapest = analysis.cheapestRoundTripPrice ?? 0;

  // Flex message 失敗時 fallback 純文字
  try {
    const flex = buildAlertFlex({
      origin: sub.origin,
      destination: sub.destination,
      outboundDate,
      returnDate,
      cheapestPrice: cheapest,
      threshold: Number(sub.max_price),
      airline: analysis.cheapestAirline ?? '—'
    });
    const client = getLineClient();
    await client.pushMessage({
      to: sub.source_id,
      messages: [flex as any]
    });
  } catch (e) {
    console.warn('[sub-checker] flex push failed, falling back to text:', e);
    await pushText(sub.source_id, formatAlertText(sub, cheapest, outboundDate, returnDate, analysis.cheapestAirline ?? '—'));
  }
}

function formatAlertText(
  sub: Subscription,
  cheapest: number,
  outboundDate: string,
  returnDate: string,
  airline: string
): string {
  return [
    '🔔 降價通知！',
    '',
    `✈️ ${formatAirport(sub.origin)} → ${formatAirport(sub.destination)}`,
    `📅 ${outboundDate} ~ ${returnDate}`,
    '',
    `💰 目前最低：NT$ ${cheapest.toLocaleString()}`,
    `🎯 你的門檻：NT$ ${Number(sub.max_price).toLocaleString()}`,
    `🏢 主推航空：${airline}`,
    '',
    '輸入「我的訂閱」可管理'
  ].join('\n');
}

function defaultDate(daysAhead: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d.toISOString().slice(0, 10);
}
