import { getSupabase } from './supabase';
import { searchFlights, AllKeysExhaustedError } from './serpapi';
import { analyzeFlights } from './flights';
import { pushText } from './line';
import { buildAlertFlex, deriveCarrierDisplay, VERDICT_FLEX_META } from './flex-message';
import { buildGroupAlertFlex } from './group-flex';
import { fetchPushIntel } from './push-intel';
import type { Verdict } from '@/app/liff/_lib/priceIntel';
import { isCoveredByGroupAlert, buildMembershipMap } from './dedupe-alerts';
import { getLineClient } from './line';
import { getCity, getCityAirports } from '@/config/airports';
import { getAirlineCategory } from '@/config/airlines';
import type { Subscription } from '@/types';

interface CheckResult {
  total: number;
  notified: number;
  skipped: number;
  errors: number;
  serpapiCalls: number;
  /** G5: 因為被群組 alert 覆蓋而 skip 的個人 alert 數 — log 觀察用，沒到 throw */
  dedupedByGroup: number;
  /** R4-B: SerpApi 全 key 配額用盡 — 給 ops-alert 當系統性訊號 */
  allKeysExhausted: boolean;
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
  const result: CheckResult = { total: 0, notified: 0, skipped: 0, errors: 0, serpapiCalls: 0, dedupedByGroup: 0, allKeysExhausted: false };

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

  // G5: 預撈所有相關的 group_member rows 給 dedupe check 用 (1 條 query，O(N))
  // 用於：cron 處理個人 sub 時 → 該 user 是否有加入「同路線同日期」的群組 →
  // 是的話跳個人 alert，群組 flex 一條 LINE 配額就涵蓋。
  const personalSubs = allSubs.filter(s => s.source_type === 'user');
  const groupSubs = allSubs.filter(s => s.source_type === 'group');
  const personalUserIds = Array.from(new Set(personalSubs.map(s => s.source_id)));
  const groupSubIds = groupSubs.map(s => s.id!).filter(Boolean);
  let membershipsByUserId = new Map<string, Set<number>>();
  if (personalUserIds.length > 0 && groupSubIds.length > 0) {
    const { data: memRows } = await supabase
      .from('group_member')
      .select('line_user_id, subscription_id')
      .in('line_user_id', personalUserIds)
      .in('subscription_id', groupSubIds);
    membershipsByUserId = buildMembershipMap((memRows ?? []) as { line_user_id: string; subscription_id: number }[]);
  }
  // groupSubs slim — dedupe 純函數要的欄位
  const groupSubsForDedupe = groupSubs.map(s => ({
    id: s.id!,
    origin: s.origin,
    destination: s.destination,
    outbound_date: s.outbound_date,
    return_date: s.return_date,
    active: s.active,
    paused: s.paused
  }));

  // 依 (origin, destination, outbound_date, return_date) 分組合併查詢
  // return_date 可為空（單程訂閱），key 第 4 段為空字串時下游轉 undefined
  const groups = new Map<string, Subscription[]>();
  for (const sub of allSubs) {
    const key = [
      sub.origin,
      sub.destination,
      sub.outbound_date ?? defaultDate(30),
      sub.return_date ?? ''
    ].join('|');
    const arr = groups.get(key) ?? [];
    arr.push(sub);
    groups.set(key, arr);
  }

  // 全 key 配額用光 → 後續 groups 立刻 skip
  let allKeysExhausted = false;

  // 所有 group 平行跑（不再 for...of 一個個等）— 避免 Vercel 60s timeout
  await Promise.all(Array.from(groups).map(async ([key, subList]) => {
    if (allKeysExhausted) {
      result.skipped += subList.length;
      return;
    }
    const [origin, destination, outboundDate, returnDateRaw] = key.split('|');
    // 單程訂閱的 returnDate 在 key 內是空字串 → 轉 undefined 給 searchFlights
    const returnDate: string | undefined = returnDateRaw === '' ? undefined : returnDateRaw;
    try {
      // 多機場城市（東京 = HND + NRT）fan-out — 跟 daily-search 一致
      // 此處僅做 raw fetch，不在 group 層做 analyzeFlights，因為每筆 sub 的時間過濾可能不同
      const destAirports = getCityAirports(destination);
      const fanout = await Promise.all(
        destAirports.map(async d => {
          const s = await searchFlights({ origin, destination: d, outboundDate, returnDate });
          return { destination: d, result: s };
        })
      );
      for (const f of fanout) result.serpapiCalls += f.result.serpapiCalls;

      // 同組訂閱依 max_price 排序，逐一檢查是否該通知
      // 注意：cheapest 是跨類最低（廉航跟傳統取其低），所以用「廉航目標價（主目標）」當第一道閘
      // 如果使用者有設「傳統另設」且廉航查無資料、只有傳統，則用 traditional target
      for (const sub of subList) {
        try {
          // 對「這筆訂閱」套用其時段窗口過濾，重新分析（fan-out 的原始 quote 重用）
          const timeFilter = {
            outboundMin: sub.outbound_min_departure_time ?? null,
            returnMin: sub.return_min_departure_time ?? null,
            outboundMax: sub.outbound_max_departure_time ?? null,
            returnMax: sub.return_max_departure_time ?? null
          };
          // 跨機場挑這筆 sub 的最便宜（含航司過濾 / 釘選航班）
          let analysis = analyzeFlights(fanout[0].result.outbound, fanout[0].result.return, timeFilter, sub.airline_filter, sub.pinned_flight_number);
          let cheapest = analysis.cheapestRoundTripPrice;
          for (const f of fanout.slice(1)) {
            const a = analyzeFlights(f.result.outbound, f.result.return, timeFilter, sub.airline_filter, sub.pinned_flight_number);
            const p = a.cheapestRoundTripPrice;
            if (p != null && (cheapest == null || p < cheapest)) {
              analysis = a;
              cheapest = p;
            }
          }
          if (cheapest == null) {
            result.skipped++;
            continue;
          }

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

          // G5: 個人 alert + caller 在「相同路線+日期」的群組 → 跳個人，讓群組 flex 涵蓋
          // (LINE 配額 + 不騷擾使用者)
          if (sub.source_type === 'user') {
            const covered = isCoveredByGroupAlert(
              {
                source_id: sub.source_id,
                origin: sub.origin,
                destination: sub.destination,
                outbound_date: sub.outbound_date,
                return_date: sub.return_date
              },
              groupSubsForDedupe,
              membershipsByUserId
            );
            if (covered) {
              console.log('[sub-checker] dedupe: skip personal sub', sub.id,
                          'for user', sub.source_id, '— covered by group watch');
              result.skipped++;
              result.dedupedByGroup++;
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
      if (err instanceof AllKeysExhaustedError) {
        // 全 key 配額用光 → 設 flag 讓其他 groups 不再嘗試
        console.error('[sub-checker] group', key, '全 key 配額用光，中止剩餘 groups:', err.message);
        allKeysExhausted = true;
        result.errors += subList.length;
      } else {
        console.error('[sub-checker] group', key, 'failed:', err);
        result.errors += subList.length;
      }
    }
  }));

  result.allKeysExhausted = allKeysExhausted;
  return result;
}

async function sendAlert(
  sub: Subscription,
  analysis: ReturnType<typeof analyzeFlights>,
  outboundDate: string,
  returnDate: string | undefined  // 單程訂閱無 returnDate
): Promise<void> {
  const cheapest = analysis.cheapestRoundTripPrice ?? 0;
  const airline = analysis.cheapestAirline ?? '—';

  // 釘選航班：清單那行顯示「捷星 · 08:30」之類的快照（pinned_flight_label），而不是只有航司名
  const topAirlines = sub.pinned_flight_number && sub.pinned_flight_label
    ? [{ airline: sub.pinned_flight_label, price: cheapest }]
    : analysis.topAirlines;

  // G4: source_type='group' → 改 push group flex（紫色 + N 人在追 + 投票領先 + LIFF deep link）
  const isGroupAlert = sub.source_type === 'group' && sub.id != null;

  // L1: 推播當下用同一顆 priceIntel 算 verdict（LINE_SURFACE_SPEC §E parity）。
  // fetchPushIntel 內部已 try/catch — 失敗回 {intel:null,...}，推播照發只少 badge。
  // R4-A: 移到 try 外 — 文字 fallback（A5）也要用 verdict/delta/carrier。
  const pushIntel = await fetchPushIntel(getSupabase(), sub, cheapest);
  const verdict: Verdict | null =
    pushIntel.intel?.status === 'ready' ? pushIntel.intel.verdict : null;
  const carrier = deriveCarrierDisplay(
    analysis.lccCombo,
    analysis.traditionalRoundTrip,
    analysis.cheapestAirline
  );

  try {
    let flex: object;
    if (isGroupAlert) {
      flex = await buildGroupFlexForSub(sub, cheapest, airline, outboundDate, returnDate, verdict, topAirlines);
    } else {
      flex = buildAlertFlex({
        origin: sub.origin,
        destination: sub.destination,
        outboundDate,
        returnDate: returnDate ?? null,
        cheapestPrice: cheapest,
        threshold: Number(sub.max_price),
        airline,
        sourceId: sub.source_id,
        verdict,
        carrier,
        topAirlines
      });
    }
    const client = getLineClient();
    await client.pushMessage({
      to: sub.source_id,
      // @ts-expect-error - LINE Bot SDK type mismatch
      messages: [flex]
    });
  } catch (e) {
    // G4: LINE quota / push error — log + fallback text，cron 繼續跑其他訂閱
    // 配額用光的 error message 通常含 'monthly limit' / 'quota' / 429
    const msg = e instanceof Error ? e.message : String(e);
    if (/quota|monthly.?limit|429/i.test(msg)) {
      console.error('[sub-checker] LINE quota exceeded — group alerts may stop until next month:', msg);
      // 仍 fallback 文字版（個人 free plan 還有空間）— 跟既有行為一致
    } else {
      console.warn('[sub-checker] flex push failed, falling back to text:', e);
    }
    await pushText(sub.source_id, formatAlertText(sub, cheapest, outboundDate, returnDate, {
      verdict,
      deltaPct: pushIntel.deltaPct,
      carrier,
      isRecentLow: pushIntel.dailyMins.length > 0 && cheapest <= Math.min(...pushIntel.dailyMins),
      fallbackAirline: airline,
      topAirlines
    }));
  }
}

/**
 * G4: 撈該 group watch 的 members + 票數最高的選項，組 group flex。
 * 失敗（拿不到 members 等）→ fallback 成個人 flex（仍能 push 但少了「N 人在追」資訊）。
 */
async function buildGroupFlexForSub(
  sub: Subscription,
  cheapest: number,
  airline: string,
  outboundDate: string,
  returnDate: string | undefined,
  verdict: Verdict | null = null,  // L1: priceIntel verdict（sendAlert 算好傳入）
  topAirlines: { airline: string; price: number }[] = []  // 前 3 便宜航空
): Promise<object> {
  const { getSupabase } = await import('./supabase');
  const supabase = getSupabase();
  const [memRes, voteRes] = await Promise.all([
    supabase
      .from('group_member')
      .select('display_name, line_user_id')
      .eq('subscription_id', sub.id!),
    supabase
      .from('date_vote')
      .select('date_option_id')
      .eq('subscription_id', sub.id!)
  ]);
  const memberRows = (memRes.data ?? []) as { display_name: string | null; line_user_id: string }[];
  const topMemberNames = memberRows
    .map(m => m.display_name ?? m.line_user_id.slice(-4))  // 沒名字用 userId 後 4 碼
    .slice(0, 3);

  // 算最高票的 option（純 JS group by）
  const voteCountByOption = new Map<number, number>();
  for (const v of (voteRes.data ?? []) as { date_option_id: number }[]) {
    voteCountByOption.set(v.date_option_id, (voteCountByOption.get(v.date_option_id) ?? 0) + 1);
  }
  let topVote: { out_date: string; ret_date: string | null; voteCount: number } | null = null;
  if (voteCountByOption.size > 0) {
    const [topOptId, topCount] = [...voteCountByOption.entries()].sort((a, b) => b[1] - a[1])[0];
    const { data: opt } = await supabase
      .from('date_option')
      .select('out_date, ret_date')
      .eq('id', topOptId)
      .maybeSingle();
    if (opt) {
      topVote = { out_date: opt.out_date, ret_date: opt.ret_date, voteCount: topCount };
    }
  }

  return buildGroupAlertFlex({
    origin: sub.origin,
    destination: sub.destination,
    outboundDate,
    returnDate: returnDate ?? null,
    cheapestPrice: cheapest,
    threshold: Number(sub.max_price),
    airline,
    groupId: sub.source_id,
    subscriptionId: sub.id!,
    memberCount: memberRows.length,
    topMemberNames,
    topVote,
    verdict,
    topAirlines
  });
}

/** R4-A: 文字 fallback 的 LIFF 連結 — 同 group-flex buildLiffUrl 模式 */
function alertLiffUrl(): string {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID?.trim();
  if (liffId) return `https://liff.line.me/${liffId}`;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://travel-flight-bot.vercel.app';
  return `${appUrl}/liff`;
}

interface AlertTextExtras {
  verdict: Verdict | null;
  deltaPct: number | null;
  carrier: { tag: 'lcc' | 'trad' | null; line: string } | null;
  isRecentLow: boolean;
  fallbackAirline: string;
  /** 前 3 便宜航空（有給就列前 3 家取代單一 carrier 行） */
  topAirlines?: { airline: string; price: number }[];
}

/**
 * R4-A: 純文字備援訊息（配額爆掉 / flex 失敗時）— LINE_SURFACE_SPEC §A5。
 * 零 emoji、【】+ ▶/↓ glyph 結構、verdict 用詞跟 Flex/LIFF 一字不差。
 * 日期維持 ISO 8601（專案慣例；A5 範本的 2/04 簡式不採 — 全產品同格式）。
 *
 * exported for tests。
 */
export function formatAlertText(
  sub: Subscription,
  cheapest: number,
  outboundDate: string,
  returnDate: string | undefined,  // 單程訂閱無 returnDate
  extras: AlertTextExtras
): string {
  const threshold = Number(sub.max_price);
  const verdictLabel = extras.verdict ? VERDICT_FLEX_META[extras.verdict].label : null;
  const header = verdictLabel ? `【價格達標・${verdictLabel}】` : '【價格達標】';

  const dates = returnDate ? `${outboundDate} ~ ${returnDate}` : `單程 ${outboundDate}`;
  const routeLine = `${getCity(sub.origin)} → ${getCity(sub.destination)}  ${sub.origin}→${sub.destination}  ${dates}`;

  // 有前 3 便宜航空 → 列前 3 家（每行：廉/傳 航司 NT$價）；否則退回單一 carrier 行
  let priceLine: string;
  if (extras.topAirlines && extras.topAirlines.length > 0) {
    const rows = extras.topAirlines.slice(0, 3).map(a => {
      const cat = getAirlineCategory(a.airline);
      const tag = cat === 'lcc' ? '廉航 ' : cat === 'full-service' ? '傳統 ' : '';
      return `　${tag}${a.airline} NT$${a.price.toLocaleString()}`;
    });
    priceLine = [`目前最低 NT$${cheapest.toLocaleString()}`, '便宜航空：', ...rows].join('\n');
  } else {
    const carrierStr = extras.carrier
      ? `（${extras.carrier.tag === 'lcc' ? '廉航 ' : extras.carrier.tag === 'trad' ? '傳統 ' : ''}${extras.carrier.line}）`
      : `（${extras.fallbackAirline}）`;
    priceLine = `目前最低 NT$${cheapest.toLocaleString()}${carrierStr}`;
  }

  // 目標價句：<1% 邊界沿用「達到」語氣（同 flex 卡）；delta 標明基準（較上週）
  const drop = threshold - cheapest;
  const dropPct = Math.round((drop / threshold) * 100);
  const targetClause = dropPct < 1
    ? `達到你的目標價 NT$${threshold.toLocaleString()}`
    : `已跌破你的目標價 NT$${threshold.toLocaleString()}`;
  const clauses = [targetClause];
  if (extras.deltaPct != null && Math.abs(extras.deltaPct) >= 0.05) {
    clauses.push(`較上週 ${extras.deltaPct < 0 ? '↓' : '↑'}${Math.abs(extras.deltaPct)}%`);
  }
  if (extras.isRecentLow) clauses.push('近 30 天最低');

  return [
    header,
    routeLine,
    priceLine,
    `${clauses.join('，')}。`,
    `看走勢與航班 ▶ ${alertLiffUrl()}`
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
