import type {
  SerpApiFlightsResponse,
  SerpApiFlight,
  FlightQuote,
  TripLeg
} from '@/types';
import { getSupabase } from './supabase';
import { isWhitelistedAirline, normalizeAirlineName } from '@/config/airlines';

const SERPAPI_BASE = 'https://serpapi.com/search.json';
const CACHE_TTL_HOURS = 6;

export interface SearchParams {
  origin: string;        // IATA, e.g. TPE
  destination: string;   // IATA, e.g. HND
  outboundDate: string;  // YYYY-MM-DD
  returnDate?: string;   // YYYY-MM-DD; if omitted, one-way
}

export interface SearchResult {
  outbound: FlightQuote[];
  return: FlightQuote[];
  fromCache: boolean;
  serpapiCalls: number;
}

/**
 * 主查詢入口。優先讀 6 小時內的快取，沒有才打 SerpApi。
 */
export async function searchFlights(params: SearchParams): Promise<SearchResult> {
  const supabase = getSupabase();
  const cacheCutoff = new Date(Date.now() - CACHE_TTL_HOURS * 3600 * 1000).toISOString();

  // ---- 1. 先檢查快取 ----
  let cacheQuery = supabase
    .from('flight_quotes')
    .select('*')
    .eq('origin', params.origin)
    .eq('destination', params.destination)
    .eq('outbound_date', params.outboundDate)
    .gte('queried_at', cacheCutoff)
    .order('queried_at', { ascending: false });

  if (params.returnDate) {
    cacheQuery = cacheQuery.eq('return_date', params.returnDate);
  } else {
    cacheQuery = cacheQuery.is('return_date', null);
  }

  const { data: cached, error: cacheErr } = await cacheQuery;

  if (!cacheErr && cached && cached.length > 0) {
    const outbound = cached.filter(q => q.trip_leg === 'outbound') as FlightQuote[];
    const ret = cached.filter(q => q.trip_leg === 'return') as FlightQuote[];
    if (outbound.length > 0) {
      return { outbound, return: ret, fromCache: true, serpapiCalls: 0 };
    }
  }

  // ---- 2. 真的去打 SerpApi ----
  let serpapiCalls = 0;

  const outboundResp = await callSerpApi({
    departure_id: params.origin,
    arrival_id: params.destination,
    outbound_date: params.outboundDate,
    return_date: params.returnDate,
    type: params.returnDate ? '1' : '2'  // 1 = round trip, 2 = one way
  });
  serpapiCalls++;

  let returnResp: SerpApiFlightsResponse | null = null;
  if (params.returnDate) {
    // SerpApi round-trip 的回程要用 departure_token 再查一次
    const firstFlight = (outboundResp.best_flights ?? outboundResp.other_flights ?? [])[0];
    const token = firstFlight?.departure_token;
    if (token) {
      returnResp = await callSerpApi({
        departure_id: params.origin,
        arrival_id: params.destination,
        outbound_date: params.outboundDate,
        return_date: params.returnDate,
        type: '1',
        departure_token: token
      });
      serpapiCalls++;
    }
  }

  // ---- 3. 轉成 FlightQuote 列陣 ----
  const outboundQuotes = extractQuotes(outboundResp, params, 'outbound');
  const returnQuotes = returnResp
    ? extractQuotes(returnResp, params, 'return')
    : [];

  // ---- 4. 寫入快取（同時是歷史紀錄）----
  const allQuotes = [...outboundQuotes, ...returnQuotes];
  if (allQuotes.length > 0) {
    const { error: insertErr } = await supabase
      .from('flight_quotes')
      .insert(allQuotes);
    if (insertErr) {
      console.error('[serpapi] failed to cache quotes:', insertErr);
    }
  }

  return {
    outbound: outboundQuotes,
    return: returnQuotes,
    fromCache: false,
    serpapiCalls
  };
}

async function callSerpApi(query: Record<string, string | undefined>): Promise<SerpApiFlightsResponse> {
  const apiKey = process.env.SERPAPI_KEY;
  if (!apiKey) throw new Error('SERPAPI_KEY not set');

  const params = new URLSearchParams({
    engine: 'google_flights',
    api_key: apiKey,
    hl: 'zh-tw',
    gl: 'tw',
    currency: 'TWD',
    ...Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined) as [string, string][])
  });

  const url = `${SERPAPI_BASE}?${params.toString()}`;

  // 每次 fetch 最多 10 秒（避免一次卡很久 → 整個 Vercel function 被殺）
  // 最多重試 1 次（總共 2 次嘗試），整體上限 ~22s（含 backoff）
  const TIMEOUT_MS = 10_000;
  const MAX_ATTEMPTS = 2;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store',
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        throw new Error(`SerpApi ${resp.status}: ${body.slice(0, 200)}`);
      }
      return (await resp.json()) as SerpApiFlightsResponse;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const isTimeout = err instanceof Error && err.name === 'AbortError';
      console.warn(`[serpapi] attempt ${attempt}/${MAX_ATTEMPTS} failed${isTimeout ? ' (timeout)' : ''}:`, err);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error('SerpApi unreachable');
}

function extractQuotes(
  resp: SerpApiFlightsResponse,
  params: SearchParams,
  leg: TripLeg
): FlightQuote[] {
  const all: { flight: SerpApiFlight; type: 'best' | 'other' }[] = [
    ...(resp.best_flights ?? []).map(f => ({ flight: f, type: 'best' as const })),
    ...(resp.other_flights ?? []).map(f => ({ flight: f, type: 'other' as const }))
  ];

  return all
    .filter(({ flight }) => {
      // 只保留同一航段全部都是白名單航空公司的航班（避免轉機航司變成廉航以外的）
      const legs = flight.flights ?? [];
      if (legs.length === 0) return false;
      const firstAirline = legs[0]?.airline ?? '';
      return isWhitelistedAirline(firstAirline);
    })
    .map(({ flight, type }) => {
      const legs = flight.flights ?? [];
      const firstLeg = legs[0];
      const airlineRaw = firstLeg?.airline ?? null;
      return {
        origin: params.origin,
        destination: params.destination,
        outbound_date: params.outboundDate,
        return_date: params.returnDate ?? null,
        airline: airlineRaw ? normalizeAirlineName(airlineRaw) : null,
        airline_code: extractAirlineCode(firstLeg?.flight_number ?? null),
        price: flight.price ?? null,
        currency: 'TWD',
        duration_minutes: flight.total_duration ?? null,
        stops: Math.max(0, legs.length - 1),
        flight_type: type,
        trip_leg: leg,
        raw: flight
      } satisfies FlightQuote;
    });
}

function extractAirlineCode(flightNumber: string | null): string | null {
  if (!flightNumber) return null;
  const m = flightNumber.match(/^([A-Z]{2})\d+/);
  return m ? m[1] : null;
}
