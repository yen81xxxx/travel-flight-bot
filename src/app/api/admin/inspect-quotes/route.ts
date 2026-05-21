import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Read-only 偵錯端點：列出指定航線 + 日期區段的最近 SerpApi 抓回來的航班資料。
 * 用 CRON_SECRET 認證（不另設 ADMIN_PASSWORD）。
 *
 * 範例：
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     "https://.../api/admin/inspect-quotes?origin=TPE&destination=HND&outbound=2027-01-30&return=2027-02-04"
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const origin = searchParams.get('origin');
  const destination = searchParams.get('destination');
  const outbound = searchParams.get('outbound');
  const ret = searchParams.get('return');

  if (!origin || !destination || !outbound) {
    return NextResponse.json({ ok: false, error: 'missing required: origin, destination, outbound' }, { status: 400 });
  }

  const supabase = getSupabase();
  let q = supabase
    .from('flight_quotes')
    .select('airline, airline_code, price, stops, duration_minutes, trip_leg, flight_type, queried_at, raw')
    .eq('origin', origin)
    .eq('destination', destination)
    .eq('outbound_date', outbound);
  if (ret) q = q.eq('return_date', ret); else q = q.is('return_date', null);
  const { data, error } = await q.order('queried_at', { ascending: false }).limit(50);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // 把 raw.flights 簡化成精簡 legs，避免回應過大
  type RawFlight = { airline?: string; flight_number?: string; departure_airport?: { id?: string }; arrival_airport?: { id?: string }; duration?: number };
  const simplified = (data ?? []).map(q => ({
    trip_leg: q.trip_leg,
    airline: q.airline,
    airline_code: q.airline_code,
    price: q.price,
    stops: q.stops,
    duration_minutes: q.duration_minutes,
    flight_type: q.flight_type,
    queried_at: q.queried_at,
    legs: ((q.raw as { flights?: RawFlight[] } | null)?.flights ?? []).map((l) => ({
      airline: l.airline,
      flight_number: l.flight_number,
      from: l.departure_airport?.id,
      to: l.arrival_airport?.id,
      duration: l.duration
    }))
  }));

  return NextResponse.json({
    ok: true,
    count: simplified.length,
    quotes: simplified
  });
}
