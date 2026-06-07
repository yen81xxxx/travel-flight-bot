import { NextRequest, NextResponse } from 'next/server';
import { searchFlights, AllKeysExhaustedError } from '@/lib/serpapi';
import { analyzeFlights } from '@/lib/flights';
import { buildMultiSubsItem, isRouteError, type RouteData, type RouteOutcome } from '@/lib/cron-items-mapper';
import { getLineClient } from '@/lib/line';
import { getSupabase } from '@/lib/supabase';
import { checkAllSubscriptions } from '@/lib/subscription-checker';
import { cleanupOldRecords, getQuotaStats } from '@/lib/cleanup';
import { buildDailyFlex, buildMultiSubsDailyFlex } from '@/lib/flex-message';
import { getCityAirports } from '@/config/airports';
import { getAirlineCategory } from '@/config/airlines';
import type { Subscription } from '@/types';
import type { SupabaseClient } from '@supabase/supabase-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest): Promise<NextResponse> {
  return runDailySearch(req);
}
export async function POST(req: NextRequest): Promise<NextResponse> {
  return runDailySearch(req);
}

async function runDailySearch(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();
  const startedAt = new Date();
  const today = new Date().toISOString().slice(0, 10);

  // ============================================
  // 1) 撈所有 active + unpaused 訂閱
  // ============================================
  const { data: rawSubs } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('active', true)
    .eq('paused', false);
  const allSubs = ((rawSubs ?? []) as Subscription[]).filter(s =>
    // 必須有 outbound_date 且未過期；沒日期或未來無效日期的訂閱直接跳過
    // （之前用 ?? '' 會把空字串送進 SerpApi → 400 → 每天浪費 retry 配額）
    !!s.outbound_date && !!s.return_date && s.outbound_date >= today
  );

  // ============================================
  // 2) 過濾 daily_summary=false 的 source（所有 active 訂閱不去重，方案 B 後每筆都列）
  // ============================================
  const allSourceIds = Array.from(new Set(allSubs.map(s => s.source_id)));
  const optedOut = new Set<string>();
  if (allSourceIds.length > 0) {
    const { data: settings } = await supabase
      .from('notification_settings')
      .select('source_id, daily_summary')
      .in('source_id', allSourceIds);
    for (const s of (settings ?? [])) {
      if (s.daily_summary === false) optedOut.add(s.source_id as string);
    }
  }
  const eligibleSubs = allSubs.filter(s => !optedOut.has(s.source_id));

  // ============================================
  // 3) 把相同 (origin, dest, outbound, return) 合併查詢（省 SerpApi 配額）
  //    注意：這裡是「route 去重」不是「source 去重」，多筆訂閱共享同條路線查詢結果
  // ============================================
  const queryGroups = new Map<string, Subscription[]>();
  for (const sub of eligibleSubs) {
    const key = [
      sub.origin,
      sub.destination,
      sub.outbound_date ?? '',
      sub.return_date ?? ''
    ].join('|');
    const arr = queryGroups.get(key) ?? [];
    arr.push(sub);
    queryGroups.set(key, arr);
  }

  // 兼容變數：targets 仍給後續 fallback 邏輯使用（targets.length === 0 才走 fallback）
  const targets = eligibleSubs;

  // ============================================
  // 5) 逐組查詢 + per-source push（個別失敗不影響其他）
  // ============================================
  const client = getLineClient();
  let pushedOk = 0;
  let pushedFail = 0;
  let totalSerpapiCalls = 0;
  let totalFromCache = 0;
  const perGroupResults: Array<{
    route: string;
    cheapest: number | null;
    fromCache: boolean;
    sourceCount: number;
  }> = [];

  // ============================================
  // 5a) 全部 routes 平行 fetch — 只存 raw quotes，不在 group 層做 analyze
  //     （每筆 sub 的時間過濾可能不同，必須延後到 5b 對每筆 sub 個別 analyze）
  // ============================================
  // RouteData / RouteOutcome 型別搬到 src/lib/cron-items-mapper.ts，跟 buildMultiSubsItem 共用
  const routeResults = new Map<string, RouteOutcome | null>();

  // 全 key 配額用光時，這個 flag 一翻 → 之後所有 route 直接 skip，
  // 不再無腦 retry 燒下個月剛 reset 的配額
  let allKeysExhausted = false;

  await Promise.all(Array.from(queryGroups).map(async ([key, group]) => {
    if (allKeysExhausted) {
      routeResults.set(key, { error: 'quota-exhausted' });
      return;
    }
    const [origin, destination, outboundDate, returnDate] = key.split('|');
    const MAX_ATTEMPTS = 2;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (allKeysExhausted) break;
      try {
        const destAirports = getCityAirports(destination);
        const [previousMins, fanout] = await Promise.all([
          queryPreviousCategoryMins(supabase, origin, destAirports, outboundDate, returnDate),
          Promise.all(
            destAirports.map(async (d) => {
              const r = await searchFlights({ origin, destination: d, outboundDate, returnDate });
              return {
                airport: d,
                outbound: r.outbound,
                return: r.return,
                fromCache: r.fromCache,
                queriedAt: r.queriedAt,
                serpapiCalls: r.serpapiCalls
              };
            })
          )
        ]);

        let groupSerpapiCalls = 0;
        let groupFromCacheAll = true;
        let bestCachedAt: string | null = null;
        for (const f of fanout) {
          groupSerpapiCalls += f.serpapiCalls;
          if (!f.fromCache) groupFromCacheAll = false;
          if (f.fromCache && (!bestCachedAt || f.queriedAt > bestCachedAt)) {
            bestCachedAt = f.queriedAt;
          }
        }
        totalSerpapiCalls += groupSerpapiCalls;
        if (groupFromCacheAll) totalFromCache++;

        // observability: log 一筆「未過濾」的 cheapest 給 perGroup
        let unfilteredCheapest: number | null = null;
        for (const f of fanout) {
          const a = analyzeFlights(f.outbound, f.return);
          if (a.cheapestRoundTripPrice != null && (unfilteredCheapest == null || a.cheapestRoundTripPrice < unfilteredCheapest)) {
            unfilteredCheapest = a.cheapestRoundTripPrice;
          }
        }
        perGroupResults.push({
          route: `${origin}-${destination}(${destAirports.join('+')}) ${outboundDate}~${returnDate}`,
          cheapest: unfilteredCheapest,
          fromCache: groupFromCacheAll,
          sourceCount: group.length
        });

        routeResults.set(key, {
          fanout: fanout.map(f => ({
            airport: f.airport,
            outbound: f.outbound,
            return: f.return,
            fromCache: f.fromCache,
            queriedAt: f.queriedAt
          })),
          previousMins,
          bestCachedAt,
          fromCacheAll: groupFromCacheAll
        });
        return;  // 成功 → 跳出 retry 迴圈
      } catch (err) {
        lastErr = err;
        if (err instanceof AllKeysExhaustedError) {
          // 全 key 配額用光 → 不 retry、設 flag 讓其他 routes 也 skip
          console.error(`[cron] route ${key} 全 key 配額用光，中止所有後續 routes:`, err.message);
          allKeysExhausted = true;
          routeResults.set(key, { error: 'quota-exhausted' });
          break;
        }
        if (attempt < MAX_ATTEMPTS) {
          console.warn(`[cron] route ${key} attempt ${attempt} failed, retrying (cache likely warm from prev attempt):`, err);
          await new Promise(r => setTimeout(r, 500));  // 500ms backoff
          continue;
        }
      }
    }
    console.error(`[cron] route ${key} failed after ${MAX_ATTEMPTS} attempts:`, lastErr);
    routeResults.set(key, null);
  }));

  // ============================================
  // 5b) 按 source_id 分組 eligibleSubs，每個 source 發一張多訂閱總表卡
  // ============================================
  const subsBySource = new Map<string, Subscription[]>();
  for (const sub of eligibleSubs) {
    const arr = subsBySource.get(sub.source_id) ?? [];
    arr.push(sub);
    subsBySource.set(sub.source_id, arr);
  }

  await Promise.all(Array.from(subsBySource).map(async ([sourceId, subs]) => {
    // 對每筆 sub 套用其時間過濾、跨機場跨分類挑最便宜，組成 MultiSubsItem
    // 邏輯抽到 cron-items-mapper.ts buildMultiSubsItem，方便單獨測試
    const items = subs.map((sub) => {
      const key = [sub.origin, sub.destination, sub.outbound_date ?? '', sub.return_date ?? ''].join('|');
      return buildMultiSubsItem(sub, routeResults.get(key));
    });

    // 找這個 source 所有 routes 裡最新 cachedAt（若全部都吃快取）
    const allCached = subs.every(sub => {
      const key = [sub.origin, sub.destination, sub.outbound_date ?? '', sub.return_date ?? ''].join('|');
      const r = routeResults.get(key);
      // RouteError 視為「不算全 cache」(isRouteError 排除掉 quota 錯誤路線)
      return r != null && !isRouteError(r) && r.fromCacheAll === true;
    });
    let combinedCachedAt: string | null = null;
    if (allCached) {
      for (const sub of subs) {
        const key = [sub.origin, sub.destination, sub.outbound_date ?? '', sub.return_date ?? ''].join('|');
        const r = routeResults.get(key);
        if (r != null && !isRouteError(r) && r.bestCachedAt && (!combinedCachedAt || r.bestCachedAt > combinedCachedAt)) {
          combinedCachedAt = r.bestCachedAt;
        }
      }
    }

    try {
      const flex = buildMultiSubsDailyFlex({ items, sourceId, cachedAt: combinedCachedAt });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await client.pushMessage({ to: sourceId, messages: [flex as any] });
      pushedOk++;
    } catch (err) {
      console.error('[cron] multi-subs push failed for', sourceId, err);
      pushedFail++;
    }
  }));

  // ============================================
  // 6) 沒訂閱的 fallback — 若 env 有設 LINE_DAILY_PUSH_TARGET，仍推一張預設 card（保留測試後門）
  // ============================================
  let fallbackResult: string | null = null;
  if (targets.length === 0) {
    const fallbackTarget = process.env.LINE_DAILY_PUSH_TARGET?.trim();
    if (fallbackTarget) {
      try {
        const origin = process.env.DEFAULT_ORIGIN ?? 'TPE';
        const destination = process.env.DEFAULT_DESTINATION ?? 'HND';
        const tripDays = parseInt(process.env.DEFAULT_TRIP_LENGTH_DAYS ?? '4', 10);
        const minAhead = parseInt(process.env.DEFAULT_TRIP_DAYS_AHEAD_MIN ?? '14', 10);
        const maxAhead = parseInt(process.env.DEFAULT_TRIP_DAYS_AHEAD_MAX ?? '90', 10);
        const offset = Math.floor((minAhead + maxAhead) / 2);
        const outboundDate = formatDate(addDays(new Date(), offset));
        const returnDate = formatDate(addDays(new Date(), offset + tripDays));
        const result = await searchFlights({ origin, destination, outboundDate, returnDate });
        totalSerpapiCalls += result.serpapiCalls;
        const analysis = analyzeFlights(result.outbound, result.return);
        const flex = buildDailyFlex({
          origin, destination, outboundDate, returnDate,
          cheapestPrice: analysis.cheapestRoundTripPrice,
          cheapestAirline: analysis.cheapestAirline,
          traditionalRoundTrip: analysis.traditionalRoundTrip,
          lccCombo: analysis.lccCombo,
          cachedAt: result.fromCache ? result.queriedAt : null
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await client.pushMessage({ to: fallbackTarget, messages: [flex as any] });
        fallbackResult = `pushed default card to ${fallbackTarget}`;
      } catch (err) {
        fallbackResult = `fallback push failed: ${err instanceof Error ? err.message : String(err)}`;
        console.error('[cron] fallback push failed:', err);
      }
    } else {
      fallbackResult = 'no subscribers and no LINE_DAILY_PUSH_TARGET set; skipped';
    }
  }

  // ============================================
  // 7) 寫一筆 search_runs 總結
  // ============================================
  await supabase.from('search_runs').insert({
    triggered_by: 'cron',
    status: pushedFail === 0 ? 'success' : 'partial',
    started_at: startedAt.toISOString(),
    finished_at: new Date().toISOString(),
    serpapi_calls: totalSerpapiCalls,
    duration_ms: Date.now() - startedAt.getTime(),
    error_message: pushedFail > 0 ? `${pushedFail} push failed` : null
  });

  // ============================================
  // 8) 跑訂閱降價檢查（這邊用每筆訂閱實際的日期，跟上面合併查詢的 cache 共用）
  // ============================================
  let subResult = { total: 0, notified: 0, skipped: 0, errors: 0, serpapiCalls: 0 };
  try {
    subResult = await checkAllSubscriptions();
  } catch (err) {
    console.error('[cron] subscription check failed:', err);
  }

  // ============================================
  // 9) 清理 + 配額
  // ============================================
  let cleanup = { flightQuotesDeleted: 0, searchRunsDeleted: 0, notificationsDeleted: 0 };
  try {
    cleanup = await cleanupOldRecords();
  } catch (err) {
    console.error('[cron] cleanup failed:', err);
  }

  let quota = { thisMonth: 0, cachedHits: 0, estimatedRemaining: 250 };
  try {
    quota = await getQuotaStats();
  } catch (err) {
    console.error('[cron] quota stats failed:', err);
  }

  return NextResponse.json({
    ok: pushedFail === 0,
    // 部署版本標記 — 改卡片版面時 bump 一下，方便從 API 回應驗證新 code 是否真的上線
    cardVersion: 'v41-quota-aware-empty-state-2026-06-06',
    daily: {
      sourcesTargeted: targets.length,
      sourcesOptedOut: optedOut.size,
      queryGroups: queryGroups.size,
      pushedOk,
      pushedFail,
      serpapiCalls: totalSerpapiCalls,
      fromCache: totalFromCache,
      perGroup: perGroupResults,
      fallback: fallbackResult
    },
    subscriptions: subResult,
    cleanup,
    quota
  });
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}
function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * 撈「昨天」（2~36 小時前）的 flight_quotes，回傳每分類的最低價。
 * 用來跟「今天」剛抓到的最低價算 delta，顯示「vs 昨日 ↓X%」。
 *
 * 關鍵：必須跟今天 analyzeFlights 的 picker 邏輯一致，否則 delta 失真。
 * - 傳統（pickTraditionalSameAirline）→ 只看 outbound list（同家來回估算）
 * - 廉航（pickLccCombo）→ 只看 return list（去 + 回 mix-and-match 精確價）
 * 若把 return list 的「廉航去 + 星宇回」當成傳統最低，會誤報「傳統漲了 X%」。
 */
async function queryPreviousCategoryMins(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, 'public', any>,
  origin: string,
  destinations: string[],
  outboundDate: string,
  returnDate: string
): Promise<{ lcc: number | null; traditional: number | null }> {
  const now = Date.now();
  const olderThan = new Date(now - 2 * 3600 * 1000).toISOString();
  const newerThan = new Date(now - 36 * 3600 * 1000).toISOString();

  const { data, error } = await supabase
    .from('flight_quotes')
    .select('airline, price, stops, trip_leg')
    .eq('origin', origin)
    .in('destination', destinations)
    .eq('outbound_date', outboundDate)
    .eq('return_date', returnDate)
    .eq('stops', 0)
    .gte('queried_at', newerThan)
    .lt('queried_at', olderThan);

  if (error || !data || data.length === 0) return { lcc: null, traditional: null };

  let lccMin = Infinity;
  let tradMin = Infinity;
  for (const q of data as { airline: string | null; price: number | null; trip_leg: string }[]) {
    if (q.price == null) continue;
    const cat = getAirlineCategory(q.airline);
    // 傳統：只看 outbound list（== pickTraditionalSameAirline 來源）
    if (cat === 'full-service' && q.trip_leg === 'outbound' && q.price < tradMin) tradMin = q.price;
    // 廉航：只看 return list（== pickLccCombo 來源，return 已是精確來回總價）
    if (cat === 'lcc' && q.trip_leg === 'return' && q.price < lccMin) lccMin = q.price;
  }

  return {
    lcc: lccMin === Infinity ? null : lccMin,
    traditional: tradMin === Infinity ? null : tradMin
  };
}
