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

/** 開口式多城市搜尋的一段 */
export interface MultiCityLeg { origin: string; destination: string; date: string; }
/** 開口式查價列出的「一組來回組合」— 用去程那班當代表，price 是整趟（去+回一張票）總價 */
export interface MultiCityOption {
  airline: string | null;      // 去程帶頭航司
  flightNumber: string | null; // 去程班號（之後釘選 / 追特定組合用）
  time: string | null;         // 去程起飛 'HH:MM'
  arrTime: string | null;      // 去程抵達 'HH:MM'（顯示「16:25→20:30」用）
  price: number;               // 整趟總價（含回程，Google 配最便宜的接；回程時間不在 multi-city 第一段回傳裡）
}
export interface MultiCityResult {
  /** 整個開口式行程（同一張多城市票）的最低總價；查無 → null */
  cheapestTotal: number | null;
  /** 最低那張票第一段的航司（顯示用） */
  airline: string | null;
  /** 多組「來回組合」清單（去程各班 + 各自整趟總價）。只有預覽 includeOptions 時才填。 */
  options: MultiCityOption[];
  fromCache: boolean;
  serpapiCalls: number;
}

/**
 * 從 multi-city response 的第一段選項，挑出「去程班 + 整趟總價」清單：
 * 偏好去程直飛、依去程班號去重（取最低）、依總價升冪、取前 limit 筆。
 */
function buildMultiCityOptions(all: SerpApiFlight[], limit = 8): MultiCityOption[] {
  const direct = all.filter(f => f.price != null && (f.flights?.length ?? 0) === 1);
  const pool = direct.length > 0 ? direct : all.filter(f => f.price != null);
  const byFlight = new Map<string, MultiCityOption>();
  for (const f of pool) {
    const leg0 = f.flights?.[0];
    // 沒班號的用「航司@價格」當 key，避免不同班被誤併
    const key = leg0?.flight_number ?? `${leg0?.airline ?? '—'}@${f.price}`;
    const opt: MultiCityOption = {
      airline: leg0?.airline ?? null,
      flightNumber: leg0?.flight_number ?? null,
      time: leg0?.departure_airport?.time?.slice(11, 16) ?? null,     // 'YYYY-MM-DD HH:MM' → 'HH:MM'
      arrTime: leg0?.arrival_airport?.time?.slice(11, 16) ?? null,
      price: f.price as number
    };
    const ex = byFlight.get(key);
    if (!ex || opt.price < ex.price) byFlight.set(key, opt);
  }
  return Array.from(byFlight.values()).sort((a, b) => a.price - b.price).slice(0, limit);
}

/**
 * 開口式 2 段 → 讀 6h 內的整程報價快取（flight_quotes 裡 return_origin/dest 有值那種）。
 * 只讀「未釘班」那種（pinned_outbound_flight IS NULL）— 釘班 sub 各自存自己的價，不能混。
 */
async function readMultiCityCache(legs: MultiCityLeg[]): Promise<{ price: number; airline: string | null } | null> {
  const [out, back] = legs;
  const cutoff = new Date(Date.now() - CACHE_TTL_HOURS * 3600 * 1000).toISOString();
  const { data, error } = await getSupabase()
    .from('flight_quotes')
    .select('price, airline')
    .eq('origin', out.origin).eq('destination', out.destination).eq('outbound_date', out.date)
    .eq('return_date', back.date).eq('return_origin', back.origin).eq('return_destination', back.destination)
    .eq('stops', 0).is('pinned_outbound_flight', null).not('price', 'is', null).gte('queried_at', cutoff)
    .order('price', { ascending: true }).limit(1);
  if (error || !data || data.length === 0) return null;
  return { price: data[0].price as number, airline: (data[0].airline as string | null) ?? null };
}

/**
 * 把開口式整程價存進 flight_quotes（=歷史來源 + 之後 6h 快取）。
 * pinnedOutboundFlight：釘了去程某班 → 存該班的整趟價，並標記是哪班（一般/最便宜的存 null）。
 */
async function storeMultiCityQuote(
  legs: MultiCityLeg[],
  best: { price: number; airline: string | null },
  pinnedOutboundFlight: string | null = null
): Promise<void> {
  const [out, back] = legs;
  const { error } = await getSupabase().from('flight_quotes').insert({
    origin: out.origin, destination: out.destination, outbound_date: out.date,
    return_date: back.date, return_origin: back.origin, return_destination: back.destination,
    airline: best.airline, airline_code: null, price: best.price, currency: 'TWD',
    duration_minutes: null, stops: 0, flight_type: 'best', trip_leg: 'outbound', raw: null,
    pinned_outbound_flight: pinnedOutboundFlight
  });
  if (error) console.error('[serpapi] failed to cache multi-city quote:', error.message);
}

/**
 * 開口式 = 真・多城市單一票（SerpApi type=3 + multi_city_json）。
 * 回傳整個行程的最低總價（Google Flights 對「選了第一段」算的整程估價）。
 * 偏好第一段直飛（flights.length===1）— 跟全站「只直飛」一致；沒有直飛才退回全部。
 * 2 段（開口式）會走 6h 快取（讀）+ 把結果存進 flight_quotes（寫，給歷史走勢用）。
 */
export async function searchMultiCity(
  legs: MultiCityLeg[],
  opts?: { includeOptions?: boolean; pinnedOutboundFlight?: string }
): Promise<MultiCityResult> {
  const pinned = opts?.pinnedOutboundFlight;
  // includeOptions（預覽用）要列出完整「多組組合」→ 跳過 6h 快取（快取只存最便宜那一筆、沒有清單）。
  // pinned（釘班）→ 也跳過：快取存的是「未釘班的最便宜」，跟釘的那班不同價。
  // 每日 cron 一般開口式（不釘班）→ 照舊吃快取、配額不變。
  if (legs.length === 2 && !opts?.includeOptions && !pinned) {
    const cached = await readMultiCityCache(legs);
    if (cached) return { cheapestTotal: cached.price, airline: cached.airline, options: [], fromCache: true, serpapiCalls: 0 };
  }
  const multi = JSON.stringify(legs.map(l => ({ departure_id: l.origin, arrival_id: l.destination, date: l.date })));
  const resp = await callSerpApi({ type: '3', multi_city_json: multi });
  const all = [...(resp.best_flights ?? []), ...(resp.other_flights ?? [])];
  const pick = (onlyDirect: boolean): { price: number; airline: string | null } | null => {
    let best: { price: number; airline: string | null } | null = null;
    for (const f of all) {
      if (f.price == null) continue;
      if (onlyDirect && (f.flights?.length ?? 0) !== 1) continue;  // 第一段直飛
      if (!best || f.price < best.price) best = { price: f.price, airline: f.flights?.[0]?.airline ?? null };
    }
    return best;
  };
  // 釘班：只看去程班號 == pinned 的那組，取其整趟總價（當天沒這班 → null，前端降級「監控中」）
  const pickPinned = (fn: string): { price: number; airline: string | null } | null => {
    let best: { price: number; airline: string | null } | null = null;
    for (const f of all) {
      if (f.price == null || f.flights?.[0]?.flight_number !== fn) continue;
      if (!best || f.price < best.price) best = { price: f.price, airline: f.flights?.[0]?.airline ?? null };
    }
    return best;
  };
  const best = pinned ? pickPinned(pinned) : (pick(true) ?? pick(false));
  if (legs.length === 2 && best) await storeMultiCityQuote(legs, best, pinned ?? null);
  return {
    cheapestTotal: best?.price ?? null,
    airline: best?.airline ?? null,
    options: opts?.includeOptions ? buildMultiCityOptions(all) : [],
    fromCache: false,
    serpapiCalls: 1
  };
}

// ============================================================
// 開口式 v2 — 「兩段配對」：去程查一次、回程查一次（各 type=2 單程），配成對顯示。
// 跟多城市單一票相反：看得到去+回兩段的完整航班（航司/班號/起降/地點），代價是
// 價格 = 兩段相加（吃不到多城市合併折扣）。
// ============================================================

/** 開口式配對裡的「一段」（去 or 回）的單一航班 */
export interface OpenJawLegFlight {
  airline: string | null;
  flightNumber: string | null;
  origin: string | null;       // 該段出發機場（直飛 = 第一段 dep）
  destination: string | null;  // 該段抵達機場
  depTime: string | null;      // 'HH:MM'
  arrTime: string | null;      // 'HH:MM'
  price: number;               // 該段單程價
}
/** 一組「去+回」配對，total = 去段 + 回段 */
export interface OpenJawPairedCombo {
  out: OpenJawLegFlight;
  back: OpenJawLegFlight;
  total: number;
}

/** 航司過濾比對：寬鬆比（含變體，如「捷星」vs「捷星日本航空」） */
function airlineMatches(flightAirline: string | null | undefined, allow: string[]): boolean {
  if (!flightAirline) return false;
  return allow.some(a => flightAirline.includes(a) || a.includes(flightAirline));
}

/**
 * 從單程 response 抽「直飛航班」清單：依班號去重取最低、依價格升冪。
 * airlines（選填）：只留這些航司的航班（開口式航司過濾用，例：只看長榮）。
 */
function extractLegFlights(resp: SerpApiFlightsResponse, limit = 8, airlines?: string[]): OpenJawLegFlight[] {
  const all = [...(resp.best_flights ?? []), ...(resp.other_flights ?? [])];
  let direct = all.filter(f => f.price != null && (f.flights?.length ?? 0) === 1);
  let any = all.filter(f => f.price != null);
  if (airlines && airlines.length > 0) {
    direct = direct.filter(f => airlineMatches(f.flights?.[0]?.airline, airlines));
    any = any.filter(f => airlineMatches(f.flights?.[0]?.airline, airlines));
  }
  const pool = direct.length > 0 ? direct : any;
  const byFlight = new Map<string, OpenJawLegFlight>();
  for (const f of pool) {
    const s = f.flights?.[0];
    const key = s?.flight_number ?? `${s?.airline ?? '—'}@${f.price}`;
    const flight: OpenJawLegFlight = {
      airline: s?.airline ?? null,
      flightNumber: s?.flight_number ?? null,
      origin: s?.departure_airport?.id ?? null,
      destination: s?.arrival_airport?.id ?? null,
      depTime: s?.departure_airport?.time?.slice(11, 16) ?? null,
      arrTime: s?.arrival_airport?.time?.slice(11, 16) ?? null,
      price: f.price as number
    };
    const ex = byFlight.get(key);
    if (!ex || flight.price < ex.price) byFlight.set(key, flight);
  }
  return Array.from(byFlight.values()).sort((a, b) => a.price - b.price).slice(0, limit);
}

/**
 * 開口式兩段配對搜尋：去程（out）查一次單程、回程（back）查一次單程，配成「去+回」對。
 * 回傳依總價排序的前 N 組（cross product 取最低，去重去/回班號相同的對）。
 */
export async function searchOpenJawPaired(
  out: MultiCityLeg,
  back: MultiCityLeg,
  opts?: { limit?: number; store?: boolean; airlines?: string[] }
): Promise<{ combos: OpenJawPairedCombo[]; cheapestTotal: number | null; airline: string | null; serpapiCalls: number }> {
  const limit = opts?.limit ?? 8;
  const [outResp, backResp] = await Promise.all([
    callSerpApi({ departure_id: out.origin, arrival_id: out.destination, outbound_date: out.date, type: '2' }),
    callSerpApi({ departure_id: back.origin, arrival_id: back.destination, outbound_date: back.date, type: '2' })
  ]);
  // 航司過濾（選填）：去/回兩段都只留勾選的航司（例：只勾長榮 → 只配長榮去+長榮回）
  const outFlights = extractLegFlights(outResp, 8, opts?.airlines);
  const backFlights = extractLegFlights(backResp, 8, opts?.airlines);
  const combos: OpenJawPairedCombo[] = [];
  for (const o of outFlights) {
    for (const b of backFlights) {
      combos.push({ out: o, back: b, total: o.price + b.price });
    }
  }
  combos.sort((a, b) => a.total - b.total);
  // 去重：同一對「去班號+回班號」只留一筆
  const seen = new Set<string>();
  const deduped: OpenJawPairedCombo[] = [];
  for (const c of combos) {
    const k = `${c.out.flightNumber ?? c.out.price}|${c.back.flightNumber ?? c.back.price}`;
    if (seen.has(k)) continue;
    seen.add(k);
    deduped.push(c);
    if (deduped.length >= limit) break;
  }
  const cheapest = deduped[0] ?? null;
  // store（cron 用）：把「最便宜那組」的整趟相加價存進 flight_quotes（=歷史 + 追蹤來源），
  // 沿用開口式那一筆（return_origin/dest 有值、pinned_outbound_flight=null）。
  if (opts?.store && cheapest) {
    await storeMultiCityQuote([out, back], { price: cheapest.total, airline: cheapest.out.airline }, null);
  }
  return {
    combos: deduped,
    cheapestTotal: cheapest?.total ?? null,
    airline: cheapest?.out.airline ?? null,
    serpapiCalls: 2
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
