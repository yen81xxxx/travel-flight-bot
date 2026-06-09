/**
 * GET /api/subscriptions/flights — 查某條航線過去 6h 內快取的「逐筆航班」
 *
 * 用途：WatchDetailSheet 在 cat-cards 下方要顯示「去程/回程選項」list。
 *   - PR #2 的 with-quotes 只給 aggregated min；本 endpoint 給完整每筆航班
 *   - 純讀取 flight_quotes，不打 SerpApi (零配額消耗)
 *   - 6h 範圍跟 with-quotes 一致 (cron + sub-checker 跟 with-quotes 都用 6h)
 *
 * Query:
 *   origin (req)         IATA, e.g. TPE
 *   destination (req)    IATA, e.g. NRT (自動 city fan-out, 東京 HND+NRT 一起撈)
 *   outboundDate (req)   YYYY-MM-DD
 *   returnDate (opt)     YYYY-MM-DD - 給就抓往返、不給就抓單程
 *
 * Returns:
 *   { ok: true, outbound: FlightRow[], return: FlightRow[] }
 *   FlightRow: { airline, airline_code, price, duration_minutes, stops, departure_time?, flight_number? }
 *
 * raw.flights[0].departure_airport.time = 'YYYY-MM-DD HH:MM' (inspect-time-format 驗過)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getCityAirports } from '@/config/airports';
import type { FlightQuote } from '@/types';
import { toFlightRow } from './helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIX_HOURS = 6 * 3600 * 1000;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sp = req.nextUrl.searchParams;
  const origin = sp.get('origin');
  const destination = sp.get('destination');
  const outboundDate = sp.get('outboundDate');
  const returnDate = sp.get('returnDate'); // null = 單程

  if (!origin || !destination || !outboundDate) {
    return NextResponse.json(
      { ok: false, error: 'origin, destination, outboundDate required' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();
  const sinceISO = new Date(Date.now() - SIX_HOURS).toISOString();
  const destinations = getCityAirports(destination);

  let query = supabase
    .from('flight_quotes')
    .select('*')
    .eq('origin', origin)
    .in('destination', destinations)
    .eq('outbound_date', outboundDate)
    .eq('stops', 0)
    .gte('queried_at', sinceISO)
    .not('price', 'is', null);

  query = returnDate ? query.eq('return_date', returnDate) : query.is('return_date', null);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as FlightQuote[];
  // outbound 跟 return 拆兩個 array — frontend 各自畫一個 list
  const outbound = rows
    .filter(r => r.trip_leg === 'outbound')
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    .map(toFlightRow);
  const returnFlights = rows
    .filter(r => r.trip_leg === 'return')
    .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
    .map(toFlightRow);

  return NextResponse.json({ ok: true, outbound, return: returnFlights });
}
