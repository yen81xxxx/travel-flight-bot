import type {
  SerpApiFlightsResponse,
  SerpApiFlight,
  FlightQuote,
  TripLeg
} from '@/types';
import { getSupabase } from './supabase';
import { normalizeAirlineName, getAirlineCategory } from '@/config/airlines';

const SERPAPI_BASE = 'https://serpapi.com/search.json';
const CACHE_TTL_HOURS = 6;

/**
 * 多 SerpApi key 輪換 — 第一支用完（429）自動換下一支。
 * 環境變數優先順序：
 *   1. SERPAPI_KEYS = "key1,key2,key3" (逗號分隔，最推薦)
 *   2. SERPAPI_KEY  = "key1" (back-compat 單支)
 * 兩個都設時 SERPAPI_KEYS 蓋過 SERPAPI_KEY。
 */
function loadSerpApiKeys(): string[] {
  const multi = process.env.SERPAPI_KEYS?.trim();
  if (multi) {
    return multi.split(',').map(k => k.trim()).filter(Boolean);
  }
  const single = process.env.SERPAPI_KEY?.trim();
  return single ? [single] : [];
}

/** 該 key 本次 Lambda invocation 已 429 → 不再嘗試（in-process 記憶體，每次 cold start 會重置） */
const exhaustedKeys = new Set<string>();

/** 整月配額 / 所有 key 都 429 時 throw 這支；cron 接到要立即中止 */
export class AllKeysExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AllKeysExhaustedError';
  }
}

function maskKey(k: string): string {
  return k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '****';
}

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
    // 只取直飛（stops=0）。舊資料可能含轉機票，這層過濾保證下游邏輯純直飛。
    const directCached = cached.filter(q => q.stops === 0);
    const outbound = directCached.filter(q => q.trip_leg === 'outbound') as FlightQuote[];
    const ret = directCached.filter(q => q.trip_leg === 'return') as FlightQuote[];
    if (outbound.length > 0) {
      // 用快取裡最新一筆的 queried_at 作為「資料時間」（cached 已 desc 排序）
      const queriedAt = (directCached[0].queried_at as string | undefined) ?? new Date().toISOString();
      return { outbound, return: ret, fromCache: true, serpapiCalls: 0, queriedAt };
    }
  }

  // ---- 2. 真的去打 SerpApi ----
  // 計數先 +1：SerpApi 依 HTTP request 計費，無論成功失敗都算配額
  // （之前在 await 之後 ++ 會漏掉失敗的 calls，搜尋實際用量遠超 search_runs 顯示值）
  let serpapiCalls = 0;

  serpapiCalls++;
  const outboundResp = await callSerpApi({
    departure_id: params.origin,
    arrival_id: params.destination,
    outbound_date: params.outboundDate,
    return_date: params.returnDate,
    type: params.returnDate ? '1' : '2'  // 1 = round trip, 2 = one way
  });

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
      serpapiCalls++;
      returnResp = await callSerpApi({
        departure_id: params.origin,
        arrival_id: params.destination,
        outbound_date: params.outboundDate,
        return_date: params.returnDate,
        type: '1',
        departure_token: token
      });
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
 * 從原始 SerpApi response 裡挑「最便宜的廉航直飛 outbound」用來查 return。
 * 必須直飛（flights.length === 1），確保 return list 配對的是純廉航直飛 outbound。
 */
function pickCheapestLccFlight(flights: SerpApiFlight[]): SerpApiFlight | null {
  let best: SerpApiFlight | null = null;
  for (const f of flights) {
    if (f.price == null) continue;
    if ((f.flights?.length ?? 0) !== 1) continue;  // 直飛 only
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

/**
 * 對單一 key 打一次 SerpApi。
 * - 429 → 拋 QuotaExceededError（外層輪換用）
 * - timeout / 其他 → 拋 generic Error（不換 key，往上拋）
 */
export class QuotaExceededError extends Error {
  constructor(public readonly key: string, body: string) {
    super(`SerpApi key ${maskKey(key)} 配額用完 (429): ${body.slice(0, 120)}`);
    this.name = 'QuotaExceededError';
  }
}

/**
 * 純邏輯的 key 輪換：給一個 keys 陣列、exhausted Set、跟試打的 callback，
 * 依序試還沒 exhausted 的 key；429 標 exhausted 後試下一支；其他錯誤直接拋。
 *
 * 抽出為純函數方便單測（不用 mock fetch / DB）。
 */
export async function rotateKeys<T>(
  keys: string[],
  exhausted: Set<string>,
  tryKey: (key: string) => Promise<T>
): Promise<T> {
  if (keys.length === 0) throw new Error('SERPAPI_KEYS / SERPAPI_KEY 都沒設定');
  const candidates = keys.filter(k => !exhausted.has(k));
  if (candidates.length === 0) {
    throw new AllKeysExhaustedError(`全部 ${keys.length} 支 SerpApi key 本月配額皆用完`);
  }
  let lastErr: unknown = null;
  for (const key of candidates) {
    try {
      return await tryKey(key);
    } catch (err) {
      if (err instanceof QuotaExceededError) {
        console.warn(`[serpapi] key ${maskKey(key)} 配額用完，換下一支`);
        exhausted.add(key);
        lastErr = err;
        continue;
      }
      // 非配額錯誤（timeout / 5xx / network）— 不換 key，往上拋
      console.warn('[serpapi] failed:', err);
      throw err;
    }
  }
  throw new AllKeysExhaustedError(
    `所有 ${candidates.length} 支可用 key 都 429；最後錯誤：${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}

async function fetchWithKey(
  apiKey: string,
  query: Record<string, string | undefined>
): Promise<SerpApiFlightsResponse> {
  const params = new URLSearchParams({
    engine: 'google_flights',
    api_key: apiKey,
    hl: 'zh-tw',
    gl: 'tw',
    currency: 'TWD',
    ...filterUndefinedParams(query)
  });

  const url = `${SERPAPI_BASE}?${params.toString()}`;
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
    if (resp.status === 429) {
      const body = await resp.text().catch(() => '');
      throw new QuotaExceededError(apiKey, body);
    }
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`SerpApi ${resp.status}: ${body.slice(0, 200)}`);
    }
    return (await resp.json()) as SerpApiFlightsResponse;
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err instanceof Error && err.name === 'AbortError';
    if (isTimeout) {
      throw new Error('SerpApi 查詢超時（這條航線太冷門或暫時擁塞），稍後再試');
    }
    throw err;
  }
}

/**
 * 公開入口 — 多 key 輪換版（呼叫 rotateKeys + fetchWithKey）。
 */
async function callSerpApi(query: Record<string, string | undefined>): Promise<SerpApiFlightsResponse> {
  return rotateKeys(loadSerpApiKeys(), exhaustedKeys, (key) => fetchWithKey(key, query));
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
      const legs = flight.flights ?? [];
      // 只保留「直飛」的航班（單一 leg），避免轉機票顯示成不存在的「同家來回」（例如「長榮 89,240」其實是長榮去沖繩 + ANA 接駁 HND）
      // 2026-06-18：不再用航司白名單過濾 —— 有直飛就存（「有飛就追」）。
      // 廉/傳分類與 currentBest 由 config/airlines 處理；未分類航空照樣被存 + 可勾選。
      return legs.length === 1;
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
