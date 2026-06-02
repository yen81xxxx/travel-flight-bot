import { getSupabase } from './supabase';
import { searchFlights } from './serpapi';
import { analyzeFlights } from './flights';
import { pushText } from './line';
import { buildAlertFlex } from './flex-message';
import { getLineClient } from './line';
import { formatAirport, getCityAirports } from '@/config/airports';
import type { Subscription } from '@/types';

interface CheckResult {
  total: number;
  notified: number;
  skipped: number;
  errors: number;
  serpapiCalls: number;
}

interface NotificationSettings {
  quietStart: string | null;
  quietEnd: string | null;
  timezone: string;
  priceAlerts: boolean;
}

/**
 * 取得今天日期（YYYY-MM-DD 格式）
 */
function getTodayDateString(): string {
  return new Date().toISOString().slice(0, 10);
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
    .eq('active', true)
    .eq('paused', false);

  if (error) {
    console.error('[sub-checker] read subs failed:', error);
    return result;
  }

  // 過濾掉出發日已過的訂閱（避免每天白白燒 SerpApi 配額）
  const today = getTodayDateString();
  const rawSubs = (subs ?? []) as Subscription[];
  const { active: allSubs, expired: expiredIds } = rawSubs.reduce(
    (acc, s) => {
      if (s.outbound_date && s.outbound_date < today) {
        if (s.id) acc.expired.push(s.id);
      } else {
        acc.active.push(s);
      }
      return acc;
    },
    { active: [] as Subscription[], expired: [] as number[] }
  );

  if (expiredIds.length > 0) {
    // 一次性軟刪除所有過期訂閱
    await supabase
      .from('subscriptions')
      .update({ active: false })
      .in('id', expiredIds);
    console.log(`[sub-checker] auto-archived ${expiredIds.length} expired subs`);
  }
  result.total = allSubs.length;

  // 抓所有 source 的通知設定（靜音時段、降價提醒開關）
  const sourceIds = Array.from(new Set(allSubs.map(s => s.source_id)));
  const settingsMap = new Map<string, NotificationSettings>();
  if (sourceIds.length > 0) {
    const { data: settings } = await supabase
      .from('notification_settings')
      .select('*')
      .in('source_id', sourceIds);
    for (const s of (settings ?? [])) {
      settingsMap.set(s.source_id, {
        quietStart: s.quiet_start,
        quietEnd: s.quiet_end,
        timezone: s.timezone ?? 'Asia/Taipei',
        priceAlerts: s.price_alerts !== false  // null/undefined 視為開啟
      });
    }
  }

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

  // 所有 group 平行跑（不再 for...of 一個個等）— 避免 Vercel 60s timeout
  await Promise.all(Array.from(groups).map(async ([key, subList]) => {
    const [origin, destination, outboundDate, returnDate] = key.split('|');
    try {
      // 多機場城市（東京 = HND + NRT）fan-out — 跟 daily-search 一致
      const destAirports = getCityAirports(destination);
      const fanout = await Promise.all(
        destAirports.map(async d => {
          const s = await searchFlights({ origin, destination: d, outboundDate, returnDate });
          return { destination: d, result: s, analysis: analyzeFlights(s.outbound, s.return) };
        })
      );
      for (const f of fanout) result.serpapiCalls += f.result.serpapiCalls;

      // 跨機場挑最便宜的 analysis（給 alert flex 用）
      let analysis = fanout[0].analysis;
      let cheapest = analysis.cheapestRoundTripPrice;
      for (const f of fanout.slice(1)) {
        const p = f.analysis.cheapestRoundTripPrice;
        if (p != null && (cheapest == null || p < cheapest)) {
          analysis = f.analysis;
          cheapest = p;
        }
      }

      if (cheapest == null) return;

      // 同組訂閱依 max_price 排序，逐一檢查是否該通知
      // 注意：cheapest 是跨類最低（廉航跟傳統取其低），所以用「廉航目標價（主目標）」當第一道閘
      // 如果使用者有設「傳統另設」且廉航查無資料、只有傳統，則用 traditional target
      for (const sub of subList) {
        try {
          const lccTarget = Number(sub.max_price);
          const tradTarget = sub.max_price_traditional != null
            ? Number(sub.max_price_traditional)
            : lccTarget;
          // 取兩個目標價較高者當「觸發門檻」— 確保任一分類跌破自己的 target 就會觸發
          // （因為 cheapest 可能來自任一分類）
          const effectiveThreshold = Math.max(lccTarget, tradTarget);
          if (cheapest > effectiveThreshold) {
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

          const setting = settingsMap.get(sub.source_id);

          // 降價提醒被關閉
          if (setting && setting.priceAlerts === false) {
            console.log('[sub-checker] price alerts disabled for source:', sub.source_id, 'skip sub:', sub.id);
            result.skipped++;
            continue;
          }

          // 靜音時段檢查
          if (setting && setting.quietStart && setting.quietEnd) {
            if (isWithinQuietHours(setting.quietStart, setting.quietEnd, setting.timezone)) {
              console.log('[sub-checker] in quiet hours, skip:', sub.id);
              result.skipped++;
              continue;
            }
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
  }));

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
      airline: analysis.cheapestAirline ?? '—',
      sourceId: sub.source_id
    });
    const client = getLineClient();
    await client.pushMessage({
      to: sub.source_id,
      // @ts-expect-error - LINE Bot SDK type mismatch
      messages: [flex]
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

/**
 * 判斷現在（依指定時區）是否落在靜音時段
 * 支援跨午夜時段（例如 22:00 ~ 08:00）
 */
function isWithinQuietHours(quietStart: string, quietEnd: string, timezone: string): boolean {
  try {
    const now = new Date();
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = fmt.formatToParts(now);
    const hour = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
    const minute = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
    const nowMin = hour * 60 + minute;

    const [sh, sm] = quietStart.split(':').map(Number);
    const [eh, em] = quietEnd.split(':').map(Number);
    const startMin = sh * 60 + sm;
    const endMin = eh * 60 + em;

    if (startMin === endMin) return false;
    if (startMin < endMin) {
      // 同一天：startMin <= now < endMin
      return nowMin >= startMin && nowMin < endMin;
    } else {
      // 跨午夜：now >= start OR now < end
      return nowMin >= startMin || nowMin < endMin;
    }
  } catch (e) {
    console.warn('[sub-checker] quiet hours parse failed:', e);
    return false;
  }
}
