import { NextRequest, NextResponse } from 'next/server';
import { searchFlights } from '@/lib/serpapi';
import { analyzeFlights, formatAnalysisForLine } from '@/lib/flights';
import { dailyPush } from '@/lib/line';
import { getSupabase } from '@/lib/supabase';
import { checkAllSubscriptions } from '@/lib/subscription-checker';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 每日排程：自動搜尋未來 N 天的便宜票 → 推 LINE。
 *
 * Vercel Cron 會以 GET 請求呼叫，並帶 Authorization: Bearer <CRON_SECRET>
 * 也可手動 POST 觸發（測試用）。
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  return runDailySearch(req);
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return runDailySearch(req);
}

async function runDailySearch(req: NextRequest): Promise<NextResponse> {
  // Cron 驗證
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

  // 找一個未來 minAhead-maxAhead 天的中位日期當「示範查詢」
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

  try {
    const result = await searchFlights({
      origin,
      destination,
      outboundDate,
      returnDate
    });
    const analysis = analyzeFlights(result.outbound, result.return);
    const text = formatAnalysisForLine(
      analysis,
      outboundDate,
      returnDate,
      origin,
      destination
    );

    // 推 LINE
    await dailyPush(text);

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

    // 跑完每日廣播後，順便檢查所有訂閱
    let subResult = { total: 0, notified: 0, skipped: 0, errors: 0 };
    try {
      subResult = await checkAllSubscriptions();
    } catch (err) {
      console.error('[cron] subscription check failed:', err);
    }

    return NextResponse.json({
      ok: true,
      origin,
      destination,
      outboundDate,
      returnDate,
      fromCache: result.fromCache,
      serpapiCalls: result.serpapiCalls,
      outboundFound: result.outbound.length,
      returnFound: result.return.length,
      analysis,
      subscriptions: subResult
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cron/daily-search] failed:', err);
    if (runRow?.id) {
      await supabase
        .from('search_runs')
        .update({
          status: 'failed',
          error_message: msg,
          duration_ms: Date.now() - startedAt.getTime(),
          finished_at: new Date().toISOString()
        })
        .eq('id', runRow.id);
    }
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

function addDays(d: Date, days: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + days);
  return x;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
