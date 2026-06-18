import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getCityAirports } from '@/config/airports';
import { normalizeAirlineName, isWhitelistedAirline, ALL_AIRLINE_NAMES } from '@/config/airlines';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/route-airlines?origin=TPE&destination=NRT
 *
 * 回這條航線「實際有飛」的白名單航司 displayName 清單（給航司過濾 checkbox 用）。
 * 純讀 flight_quotes（近 30 天、stops=0），不打 SerpApi、不燒配額。
 *
 * 多機場城市（東京 = NRT + HND）會合併。沒有任何資料（全新航線還沒查過）→
 * fallback 回全部 4 家白名單，讓使用者照樣能勾、之後有資料再精準。
 */
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const origin = req.nextUrl.searchParams.get('origin');
  const destination = req.nextUrl.searchParams.get('destination');
  if (!origin || !destination) {
    return NextResponse.json({ ok: false, error: 'origin and destination required' }, { status: 400 });
  }

  try {
    const supabase = getSupabase();
    const destAirports = getCityAirports(destination);
    const since = new Date(Date.now() - THIRTY_DAYS).toISOString();

    const { data, error } = await supabase
      .from('flight_quotes')
      .select('airline')
      .eq('origin', origin)
      .in('destination', destAirports)
      .eq('stops', 0)
      .gte('queried_at', since)
      .not('airline', 'is', null);
    if (error) throw new Error(error.message);

    // normalize → 只留白名單 → 去重，保持 ALL_AIRLINE_NAMES 的順序（顯示穩定）
    const seen = new Set<string>();
    for (const r of (data ?? []) as { airline: string | null }[]) {
      if (isWhitelistedAirline(r.airline)) seen.add(normalizeAirlineName(r.airline!));
    }
    const airlines = ALL_AIRLINE_NAMES.filter(n => seen.has(n));

    // 沒資料 → fallback 全部白名單（全新航線也能照樣勾）
    return NextResponse.json({
      ok: true,
      airlines: airlines.length > 0 ? airlines : ALL_AIRLINE_NAMES,
      fromData: airlines.length > 0
    });
  } catch (e) {
    // 查失敗也別擋住建立流程 → 回全部白名單
    console.warn('[route-airlines] failed, fallback to all:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: true, airlines: ALL_AIRLINE_NAMES, fromData: false });
  }
}
