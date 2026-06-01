import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getCityAirports } from '@/config/airports';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DayPoint {
  date: string;     // YYYY-MM-DD
  minPrice: number; // 該日該航線最便宜往返
}

/**
 * 回傳某條航線過去 N 天每日最便宜往返價
 * Query: origin, destination, outboundDate?, returnDate?, days=30
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const origin = sp.get('origin');
  const destination = sp.get('destination');
  const outboundDate = sp.get('outboundDate');
  const returnDate = sp.get('returnDate');
  const days = Math.min(365, parseInt(sp.get('days') ?? '30', 10));

  if (!origin || !destination) {
    return NextResponse.json({ ok: false, error: 'origin and destination required' }, { status: 400 });
  }

  const supabase = getSupabase();
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  // 多機場城市（東京 = HND + NRT）合併，跟 bot 的歷史 flex 邏輯一致
  const allAirports = getCityAirports(destination);
  let query = supabase
    .from('flight_quotes')
    .select('queried_at, price, trip_leg, outbound_date, return_date')
    .eq('origin', origin)
    .in('destination', allAirports)
    .eq('stops', 0)
    .gte('queried_at', since)
    .not('price', 'is', null);

  if (outboundDate) query = query.eq('outbound_date', outboundDate);
  if (returnDate) query = query.eq('return_date', returnDate);

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // SerpApi 規格：outbound entries 的 price 已經是「估算來回總價」，return entries 也是「精確來回總價」。
  // 所以 daily 最便宜 = min(所有 outbound + return entries 的 price)，不要再相加（之前 bug 顯示 43k-44k）。
  const byDay = new Map<string, number[]>();
  for (const r of (rows ?? [])) {
    const day = (r.queried_at as string).slice(0, 10);
    const arr = byDay.get(day) ?? [];
    arr.push(Number(r.price));
    byDay.set(day, arr);
  }

  const points: DayPoint[] = [];
  for (const [day, prices] of byDay) {
    if (prices.length === 0) continue;
    points.push({ date: day, minPrice: Math.min(...prices) });
  }

  points.sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ ok: true, points });
}
