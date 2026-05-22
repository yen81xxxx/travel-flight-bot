import { NextRequest, NextResponse } from 'next/server';
import { searchFlights } from '@/lib/serpapi';
import { analyzeFlights } from '@/lib/flights';
import { getLineClient } from '@/lib/line';
import { getSupabase } from '@/lib/supabase';
import { checkAllSubscriptions } from '@/lib/subscription-checker';
import { cleanupOldRecords, getQuotaStats } from '@/lib/cleanup';
import { buildDailyFlex } from '@/lib/flex-message';
import { getCityAirports } from '@/config/airports';
import type { Subscription } from '@/types';

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
    !s.outbound_date || s.outbound_date >= today
  );

  // ============================================
  // 2) 每個 source 找「最近一筆訂閱」（按 outbound_date 升冪）
  // ============================================
  const nearestBySource = new Map<string, Subscription>();
  for (const sub of allSubs) {
    const existing = nearestBySource.get(sub.source_id);
    if (!existing) {
      nearestBySource.set(sub.source_id, sub);
      continue;
    }
    const a = sub.outbound_date ?? '9999-12-31';
    const b = existing.outbound_date ?? '9999-12-31';
    if (a < b) nearestBySource.set(sub.source_id, sub);
  }

  // ============================================
  // 3) 過濾 daily_summary=false 的 source
  // ============================================
  const allSourceIds = Array.from(nearestBySource.keys());
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
  const targets: { source: string; sub: Subscription }[] = [];
  for (const [src, sub] of nearestBySource) {
    if (!optedOut.has(src)) targets.push({ source: src, sub });
  }

  // ============================================
  // 4) 把相同 (origin, dest, outbound, return) 合併查詢（省 SerpApi 配額）
  // ============================================
  const queryGroups = new Map<string, typeof targets>();
  for (const t of targets) {
    const key = [
      t.sub.origin,
      t.sub.destination,
      t.sub.outbound_date ?? '',
      t.sub.return_date ?? ''
    ].join('|');
    const arr = queryGroups.get(key) ?? [];
    arr.push(t);
    queryGroups.set(key, arr);
  }

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

  for (const [key, group] of queryGroups) {
    const [origin, destination, outboundDate, returnDate] = key.split('|');
    try {
      // 多機場城市（東京 = HND + NRT）fan-out 查詢，廉航通常 HND、傳統通常 NRT
      const destAirports = getCityAirports(destination);
      const fanout = await Promise.all(
        destAirports.map(async (d) => {
          const r = await searchFlights({ origin, destination: d, outboundDate, returnDate });
          return { destination: d, result: r, analysis: analyzeFlights(r.outbound, r.return) };
        })
      );

      let groupSerpapiCalls = 0;
      let groupFromCacheAll = true;
      for (const f of fanout) {
        groupSerpapiCalls += f.result.serpapiCalls;
        if (!f.result.fromCache) groupFromCacheAll = false;
      }
      totalSerpapiCalls += groupSerpapiCalls;
      if (groupFromCacheAll) totalFromCache++;

      // 跨機場挑各分類最便宜
      let bestLcc: { price: number; outboundAirline: string; returnAirline: string; airport: string } | null = null;
      let bestTrad: { price: number; airline: string; airport: string } | null = null;
      let bestCheapest: { price: number; airline: string | null; airport: string } | null = null;
      let bestCachedAt: string | null = null;
      for (const f of fanout) {
        const a = f.analysis;
        if (a.lccCombo && (!bestLcc || a.lccCombo.price < bestLcc.price)) {
          bestLcc = { ...a.lccCombo, airport: f.destination };
        }
        if (a.traditionalRoundTrip && (!bestTrad || a.traditionalRoundTrip.price < bestTrad.price)) {
          bestTrad = { ...a.traditionalRoundTrip, airport: f.destination };
        }
        if (a.cheapestRoundTripPrice != null && (!bestCheapest || a.cheapestRoundTripPrice < bestCheapest.price)) {
          bestCheapest = { price: a.cheapestRoundTripPrice, airline: a.cheapestAirline, airport: f.destination };
        }
        if (f.result.fromCache && (!bestCachedAt || f.result.queriedAt > bestCachedAt)) {
          bestCachedAt = f.result.queriedAt;
        }
      }

      perGroupResults.push({
        route: `${origin}-${destination}(${destAirports.join('+')}) ${outboundDate}~${returnDate}`,
        cheapest: bestCheapest?.price ?? null,
        fromCache: groupFromCacheAll,
        sourceCount: group.length
      });

      // push to every target in this group with their own threshold
      await Promise.allSettled(
        group.map(async (t) => {
          try {
            const flex = buildDailyFlex({
              origin,
              destination,
              outboundDate,
              returnDate,
              cheapestPrice: bestCheapest?.price ?? null,
              cheapestAirline: bestCheapest?.airline ?? null,
              traditionalRoundTrip: bestTrad,
              lccCombo: bestLcc,
              cachedAt: groupFromCacheAll ? bestCachedAt : null,
              threshold: Number(t.sub.max_price),
              sourceId: t.source
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await client.pushMessage({ to: t.source, messages: [flex as any] });
            pushedOk++;
          } catch (err) {
            console.error('[cron] push failed for', t.source, err);
            pushedFail++;
          }
        })
      );
    } catch (err) {
      console.error('[cron] search failed for', key, err);
      pushedFail += group.length;
    }
  }

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
    cardVersion: 'v5-multi-airport-2026-05-22',
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
