import { NextRequest, NextResponse } from 'next/server';
import { searchFlights } from '@/lib/serpapi';
import { analyzeFlights } from '@/lib/flights';
import { dailyPush, getLineClient } from '@/lib/line';
import { getSupabase } from '@/lib/supabase';
import { checkAllSubscriptions } from '@/lib/subscription-checker';
import { cleanupOldRecords, getQuotaStats } from '@/lib/cleanup';
import { buildDailyFlex } from '@/lib/flex-message';

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

  const origin = process.env.DEFAULT_ORIGIN ?? 'TPE';
  const destination = process.env.DEFAULT_DESTINATION ?? 'HND';
  const tripDays = parseInt(process.env.DEFAULT_TRIP_LENGTH_DAYS ?? '4', 10);
  const minAhead = parseInt(process.env.DEFAULT_TRIP_DAYS_AHEAD_MIN ?? '14', 10);
  const maxAhead = parseInt(process.env.DEFAULT_TRIP_DAYS_AHEAD_MAX ?? '90', 10);
  const offset = Math.floor((minAhead + maxAhead) / 2);
  const outboundDate = formatDate(addDays(new Date(), offset));
  const returnDate = formatDate(addDays(new Date(), offset + tripDays));

  const supabase = getSupabase();
  const startedAt = new Date();
  const { data: runRow } = await supabase
    .from('search_runs')
    .insert({
      triggered_by: 'cron',
      origin,
      destination,
      outbound_date: outboundDate,
      return_date: returnDate,
      status: 'success',
      started_at: startedAt.toISOString()
    })
    .select()
    .single();

  let dailyResult: any = null;
  let dailyError: string | null = null;

  try {
    const result = await searchFlights({ origin, destination, outboundDate, returnDate });
    const analysis = analyzeFlights(result.outbound, result.return);

    // 推 Flex Message 給有訂閱 + daily_summary 開啟的 source
    // （個人 / 群組統一處理；尊重每個 source 的「每日摘要」開關）
    try {
      const flex = buildDailyFlex({
        origin, destination, outboundDate, returnDate,
        cheapestPrice: analysis.cheapestRoundTripPrice,
        cheapestAirline: analysis.cheapestAirline,
        outboundCount: analysis.outboundCount,
        returnCount: analysis.returnCount
      });
      const client = getLineClient();
      const target = process.env.LINE_DAILY_PUSH_TARGET?.trim();

      if (target) {
        // 後門：env 有指定就只推那一個
        await client.pushMessage({ to: target, messages: [flex as any] });
      } else {
        // 撈所有有訂閱的 distinct source_id（個人 + 群組）
        const { data: subs } = await supabase
          .from('subscriptions')
          .select('source_id')
          .eq('active', true)
          .eq('paused', false);
        const allSourceIds = Array.from(new Set((subs ?? []).map(s => s.source_id as string)));

        if (allSourceIds.length === 0) {
          console.log('[cron] no active subscribers, skip daily push');
        } else {
          // 撈每個 source 的 daily_summary 設定（沒設過預設 true）
          const { data: settings } = await supabase
            .from('notification_settings')
            .select('source_id, daily_summary')
            .in('source_id', allSourceIds);
          const optedOut = new Set<string>();
          for (const s of (settings ?? [])) {
            if (s.daily_summary === false) optedOut.add(s.source_id as string);
          }
          const targets = allSourceIds.filter(id => !optedOut.has(id));
          console.log(`[cron] daily push: ${targets.length}/${allSourceIds.length} sources opted in`);

          // 逐一 pushMessage（單筆失敗不影響其他）
          await Promise.allSettled(
            targets.map(to => client.pushMessage({ to, messages: [flex as any] }))
          );
        }
      }
    } catch (e) {
      console.warn('[cron] flex daily push failed, fallback text:', e);
      const text = analysis.cheapestRoundTripPrice
        ? `✈️ 今日 ${origin}→${destination} 最低 NT$ ${analysis.cheapestRoundTripPrice.toLocaleString()}`
        : `✈️ 今日 ${origin}→${destination} 沒搜到資料`;
      await dailyPush(text);
    }

    if (runRow?.id) {
      await supabase
        .from('search_runs')
        .update({
          status: result.fromCache ? 'cached' : 'success',
          serpapi_calls: result.serpapiCalls,
          duration_ms: Date.now() - startedAt.getTime(),
          finished_at: new Date().toISOString()
        })
        .eq('id', runRow.id);
    }

    dailyResult = {
      origin, destination, outboundDate, returnDate,
      fromCache: result.fromCache,
      serpapiCalls: result.serpapiCalls,
      cheapest: analysis.cheapestRoundTripPrice
    };
  } catch (err) {
    dailyError = err instanceof Error ? err.message : String(err);
    console.error('[cron] daily search failed:', err);
    if (runRow?.id) {
      await supabase
        .from('search_runs')
        .update({
          status: 'failed',
          error_message: dailyError,
          duration_ms: Date.now() - startedAt.getTime(),
          finished_at: new Date().toISOString()
        })
        .eq('id', runRow.id);
    }
  }

  // 跑訂閱檢查（合併查詢）
  let subResult = { total: 0, notified: 0, skipped: 0, errors: 0, serpapiCalls: 0 };
  try {
    subResult = await checkAllSubscriptions();
  } catch (err) {
    console.error('[cron] subscription check failed:', err);
  }

  // 清理舊資料
  let cleanup = { flightQuotesDeleted: 0, searchRunsDeleted: 0, notificationsDeleted: 0 };
  try {
    cleanup = await cleanupOldRecords();
  } catch (err) {
    console.error('[cron] cleanup failed:', err);
  }

  // 配額統計
  let quota = { thisMonth: 0, cachedHits: 0, estimatedRemaining: 250 };
  try {
    quota = await getQuotaStats();
  } catch (err) {
    console.error('[cron] quota stats failed:', err);
  }

  return NextResponse.json({
    ok: dailyError === null,
    daily: dailyResult,
    dailyError,
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
