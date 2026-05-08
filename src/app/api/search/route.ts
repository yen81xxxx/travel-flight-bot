import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { searchFlights } from '@/lib/serpapi';
import { analyzeFlights, formatAnalysisForLine } from '@/lib/flights';
import { pushText } from '@/lib/line';
import { getSupabase } from '@/lib/supabase';
import { TW_ORIGINS, JP_DESTINATIONS, ALL_AIRPORTS, isTaiwanAirport, isJapanAirport } from '@/config/airports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;  // 含 2 次 SerpApi（round-trip）+ DB + push

const VALID_IATA = ALL_AIRPORTS.map(a => a.iata);

const SearchBody = z.object({
  origin: z.enum(VALID_IATA as [string, ...string[]]),
  destination: z.enum(VALID_IATA as [string, ...string[]]),
  outboundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sourceId: z.string().optional()
}).refine(
  (data) => {
    // 出發地與目的地必須一個在台灣、一個在日本
    const tw1 = isTaiwanAirport(data.origin);
    const jp1 = isJapanAirport(data.origin);
    const tw2 = isTaiwanAirport(data.destination);
    const jp2 = isJapanAirport(data.destination);
    return (tw1 && jp2) || (jp1 && tw2);
  },
  { message: '出發地與目的地必須一個在台灣、一個在日本' }
);

/**
 * 任意人都可呼叫的搜尋 API（給 LIFF / 網站表單用）。
 * - 走 6 小時快取，省 SerpApi 配額
 * - 若有 sourceId，搜尋完同時 push LINE 訊息
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    return await handlePost(req);
  } catch (err) {
    // 最後一道保險：任何沒被內層 catch 接到的錯誤，都回 JSON
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/search] uncaught error:', err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

async function handlePost(req: NextRequest): Promise<NextResponse> {
  let body: z.infer<typeof SearchBody>;
  try {
    const raw = await req.json();
    body = SearchBody.parse(raw);
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'Invalid request body', details: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  if (new Date(body.outboundDate) >= new Date(body.returnDate)) {
    return NextResponse.json(
      { ok: false, error: '回程日期必須晚於去程日期' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();
  const startedAt = new Date();

  // 整支 route 包在大 try/catch，確保任何錯誤都回 JSON
  let runRow: { id?: number } | null = null;
  try {
    const { data } = await supabase
      .from('search_runs')
      .insert({
        triggered_by: body.sourceId ? 'line' : 'manual',
        source_id: body.sourceId ?? null,
        origin: body.origin,
        destination: body.destination,
        outbound_date: body.outboundDate,
        return_date: body.returnDate,
        status: 'success',
        started_at: startedAt.toISOString()
      })
      .select()
      .single();
    runRow = data;
  } catch (err) {
    console.warn('[api/search] failed to log search_run (continuing):', err);
  }

  try {
    const result = await searchFlights({
      origin: body.origin,
      destination: body.destination,
      outboundDate: body.outboundDate,
      returnDate: body.returnDate
    });

    const analysis = analyzeFlights(result.outbound, result.return);

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

    // 若是從 LINE 過來的（帶 sourceId），同時 push 結果到聊天室
    if (body.sourceId) {
      const text = formatAnalysisForLine(
        analysis,
        body.outboundDate,
        body.returnDate,
        body.origin,
        body.destination
      );
      try {
        await pushText(body.sourceId, text);
      } catch (e) {
        console.warn('[api/search] push to LINE failed:', e);
      }
    }

    return NextResponse.json({
      ok: true,
      origin: body.origin,
      destination: body.destination,
      outboundDate: body.outboundDate,
      returnDate: body.returnDate,
      fromCache: result.fromCache,
      serpapiCalls: result.serpapiCalls,
      outbound: result.outbound,
      return: result.return,
      analysis
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/search] failed:', err);
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

/**
 * 給 LIFF 頁面初始化用：回傳機場清單
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    origins: TW_ORIGINS,
    destinations: JP_DESTINATIONS
  });
}
