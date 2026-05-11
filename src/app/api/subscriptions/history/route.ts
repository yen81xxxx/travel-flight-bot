import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

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

  let query = supabase
    .from('flight_quotes')
    .select('queried_at, price, trip_leg, outbound_date, return_date')
    .eq('origin', origin)
    .eq('destination', destination)
    .gte('queried_at', since)
    .not('price', 'is', null);

  if (outboundDate) query = query.eq('outbound_date', outboundDate);
  if (returnDate) query = query.eq('return_date', returnDate);

  const { data: rows, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // 將 outbound + return 各自最便宜加總，按日聚合
  const byDay = new Map<string, { outbound: number[]; return: number[] }>();
  for (const r of (rows ?? [])) {
    const day = (r.queried_at as string).slice(0, 10);
    const acc = byDay.get(day) ?? { outbound: [], return: [] };
    if (r.trip_leg === 'outbound') acc.outbound.push(Number(r.price));
    else if (r.trip_leg === 'return') acc.return.push(Number(r.price));
    byDay.set(day, acc);
  }

  const points: DayPoint[] = [];
  for (const [day, acc] of byDay) {
    const minOut = acc.outbound.length ? Math.min(...acc.outbound) : null;
    const minRet = acc.return.length ? Math.min(...acc.return) : null;
    let total: number | null = null;
    if (minOut != null && minRet != null) total = minOut + minRet;
    else if (minOut != null && acc.return.length === 0) total = minOut; // round-trip combined case
    if (total != null) {
      points.push({ date: day, minPrice: total });
    }
  }

  points.sort((a, b) => a.date.localeCompare(b.date));

  return NextResponse.json({ ok: true, points });
}
