import type {
  SerpApiFlightsResponse,
  SerpApiFlight,
  FlightQuote,
  TripLeg
} from '@/types';
import { getSupabase } from './supabase';
import { isWhitelistedAirline, normalizeAirlineName, getAirlineCategory } from '@/config/airlines';

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
  /** ISO timestamp 標示這份資料實際被查到的時間（cache hit 用快取時間，新查用 fetch 當下） */
  queriedAt: string;
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
      // 用快取裡最新一筆的 queried_at 作為「資料時間」（cached 已 desc 排序）
      const queriedAt = (cached[0].queried_at as string | undefined) ?? new Date().toISOString();
      return { outbound, return: ret, fromCache: true, serpapiCalls: 0, queriedAt };
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
    // SerpApi round-trip 的回程要用 departure_token 再查一次。
    // 優先用「最便宜的廉航 outbound」的 token，這樣 return 列表會是「該廉航去 + 各家廉航回」的混搭組合，
    // 可以拿到真實的廉航 mix-and-match 最低價（虎航去 + 捷星回 之類）。
    // 沒有廉航時 fallback 回第一個 flight（維持原本行為）。
    const allFlights = [...(outboundResp.best_flights ?? []), ...(outboundResp.other_flights ?? [])];
    const cheapestLccOutbound = pickCheapestLccFlight(allFlights);
    const token = cheapestLccOutbound?.departure_token ?? allFlights[0]?.departure_token;
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
  const queriedAt = new Date().toISOString();
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
    serpapiCalls,
    queriedAt
  };
}

/**
 * 從原始 SerpApi response 裡挑「最便宜的廉航 outbound」用來查 return。
 * 拿第一段（去程第一個 leg）的航空判分類，符合 outbound 主航司的常見定義。
 */
function pickCheapestLccFlight(flights: SerpApiFlight[]): SerpApiFlight | null {
  let best: SerpApiFlight | null = null;
  for (const f of flights) {
    if (f.price == null) continue;
    const firstAirline = f.flights?.[0]?.airline ?? '';
    if (getAirlineCategory(firstAirline) !== 'lcc') continue;
    if (best == null || (f.price < (best.price ?? Number.POSITIVE_INFINITY))) best = f;
  }
  return best;
}

function filterUndefinedParams(query: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(query).filter((entry) => entry[1] !== undefined)
  ) as Record<string, string>;
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
    ...filterUndefinedParams(query)
  });

  const url = `${SERPAPI_BASE}?${params.toString()}`;

  // 每次 fetch 最多 25 秒（SerpApi 對冷門路線可能需要久一點）
  // 不 retry（timeout 通常代表 SerpApi 真的慢，重試只會更慢）
  const TIMEOUT_MS = 25_000;

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
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    console.warn(`[serpapi] failed${isTimeout ? ' (timeout 25s)' : ''}:`, err);
    if (isTimeout) {
      throw new Error('SerpApi 查詢超時（這條航線太冷門或暫時擁塞），稍後再試');
    }
    throw err;
  }
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
