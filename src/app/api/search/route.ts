import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { searchFlights, searchMultiCity, searchOpenJawPaired } from '@/lib/serpapi';
import { analyzeFlights, formatAnalysisForLine } from '@/lib/flights';
import { pushText } from '@/lib/line';
import { getSupabase } from '@/lib/supabase';
import { ALL_AIRPORTS, TW_ORIGINS, JP_DESTINATIONS, isTaiwanAirport, isJapanAirport } from '@/config/airports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;  // 含 2 次 SerpApi（round-trip）+ DB + push

const VALID_IATA = ALL_AIRPORTS.map(a => a.iata);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const LegSchema = z.object({
  origin: z.enum(VALID_IATA as [string, ...string[]]),
  destination: z.enum(VALID_IATA as [string, ...string[]]),
  date: z.string().regex(ISO_DATE)
});

const SearchBody = z.object({
  // 單一路線模式（origin/destination/outboundDate）— legs 模式時這些可省略
  origin: z.enum(VALID_IATA as [string, ...string[]]).optional(),
  destination: z.enum(VALID_IATA as [string, ...string[]]).optional(),
  outboundDate: z.string().regex(ISO_DATE).optional(),
  // returnDate 省略 → 單程搜尋（searchFlights 內部用 type=2 one-way）
  returnDate: z.string().regex(ISO_DATE).optional(),
  // 開口式多城市模式：給 2 段（去/回 不同地點）→ 走 SerpApi multi-city，回傳整程最低總價
  legs: z.array(LegSchema).length(2).optional(),
  // paired=true：開口式改「兩段配對」（去/回各查一次單程、配成對），回傳去+回完整航班的組合清單
  paired: z.boolean().optional(),
  sourceId: z.string().optional()
}).superRefine((d, ctx) => {
  if (d.legs) return;  // 多城市模式：legs 由 LegSchema 驗
  // 單一路線模式：origin/destination/outboundDate 必填 + 一台一日
  if (!d.origin || !d.destination || !d.outboundDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '需要 origin / destination / outboundDate，或改用 legs（開口式）' });
    return;
  }
  const ok = (isTaiwanAirport(d.origin) && isJapanAirport(d.destination))
    || (isJapanAirport(d.origin) && isTaiwanAirport(d.destination));
  if (!ok) ctx.addIssue({ code: z.ZodIssueCode.custom, message: '出發地與目的地必須一個在台灣、一個在日本' });
});

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

  // === 開口式：兩段配對（去/回各查一次單程，配成「去+回」對，看得到兩段完整航班）===
  if (body.legs && body.paired) {
    try {
      const [out, back] = body.legs;
      const r = await searchOpenJawPaired(
        { origin: out.origin, destination: out.destination, date: out.date },
        { origin: back.origin, destination: back.destination, date: back.date }
      );
      return NextResponse.json({
        ok: true, paired: true,
        cheapestTotal: r.cheapestTotal,
        combos: r.combos,
        serpapiCalls: r.serpapiCalls
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[api/search] open-jaw paired failed:', err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  // === 開口式多城市模式：一張多城市票的整程最低總價 ===
  if (body.legs) {
    try {
      // includeOptions：列出多組「來回組合」給預覽挑（預覽即時抓，不吃 6h 快取）
      const result = await searchMultiCity(
        body.legs.map(l => ({ origin: l.origin, destination: l.destination, date: l.date })),
        { includeOptions: true }
      );
      return NextResponse.json({
        ok: true, multiCity: true,
        cheapestTotal: result.cheapestTotal,
        airline: result.airline,
        options: result.options,
        serpapiCalls: result.serpapiCalls
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[api/search] multi-city failed:', err);
      return NextResponse.json({ ok: false, error: msg }, { status: 500 });
    }
  }

  // 到這裡一定是單一路線模式（multi-city 已 return）— superRefine 保證三欄都有，narrow 型別
  if (!body.origin || !body.destination || !body.outboundDate) {
    return NextResponse.json({ ok: false, error: '缺少搜尋條件' }, { status: 400 });
  }

  // 來回搜尋才檢查回程晚於去程；單程不需要
  if (body.returnDate && new Date(body.outboundDate) >= new Date(body.returnDate)) {
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
        return_date: body.returnDate ?? null,  // 單程 → null
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
