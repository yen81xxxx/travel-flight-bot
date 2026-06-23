/**
 * GET /api/subscriptions/with-quotes?sourceId=X[&days=30]
 *
 * Vision watchlist 主要資料 endpoint。回傳 [{ ...subscription, quote: WatchQuote | null }]
 *
 * 對應 design_handoff_travl_vision/API_CONTRACT.md。
 *
 * 資料來源策略（PR #1 確認方案 B）：
 *   - currentBest/lcc/trad ← flight_quotes 過去 6h（cron 寫入的、跟卡片邏輯一致）
 *   - deltaPct             ← 即時算：7 天前 ±1 天最低 vs 現在
 *   - history              ← 過去 N 天 (預設 30) 每日 minPrice，'M/D' 格式
 *
 * 所有 quote 子欄位都可 null — frontend 必須 graceful degrade（README §6）。
 *
 * 跟既有 GET /api/subscriptions 並存，不取代它（後者是 cheap list、本 endpoint 是 expensive read）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getCityAirports } from '@/config/airports';
import type { Subscription, FlightQuote } from '@/types';
import type { WatchWithQuote } from '@/app/liff/_types';
import {
  buildWatchQuote,
  type QuoteSourceData,
  type AirportFlights
} from './quote-builder';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SIX_HOURS = 6 * 3600 * 1000;
const ONE_DAY = 86400 * 1000;
const DEFAULT_HISTORY_DAYS = 30;
const MAX_HISTORY_DAYS = 90;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sourceId = req.nextUrl.searchParams.get('sourceId');
  if (!sourceId) {
    return NextResponse.json({ ok: false, error: 'sourceId required' }, { status: 400 });
  }
  const daysParam = parseInt(req.nextUrl.searchParams.get('days') ?? String(DEFAULT_HISTORY_DAYS), 10);
  const days = Math.min(MAX_HISTORY_DAYS, Math.max(1, isNaN(daysParam) ? DEFAULT_HISTORY_DAYS : daysParam));

  const supabase = getSupabase();

  // === Step 1: 撈該 sourceId 的所有 active 訂閱（跟現有 GET 對齊） ===
  const { data: subsData, error: subsErr } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('source_id', sourceId)
    .eq('active', true)
    .order('created_at', { ascending: false });

  if (subsErr) {
    return NextResponse.json({ ok: false, error: subsErr.message }, { status: 500 });
  }
  const subs = (subsData ?? []) as Subscription[];

  // === G1: 用一條 query 拿所有訂閱的成員計數（避免 N+1） ===
  // group_member 表存 (subscription_id, line_user_id) 每筆 row 是一個成員，
  // 我們只需要每個 subscription_id 的 member 數量。
  const subIds = subs.map(s => s.id!).filter(Boolean);
  const memberCountBySub = await fetchMemberCounts(supabase, subIds);

  // === Step 2: 對每筆訂閱算 quote — 平行跑（沒互相依賴） ===
  const watches: WatchWithQuote[] = await Promise.all(
    subs.map(async (sub): Promise<WatchWithQuote> => {
      const quote = await computeQuoteForSub(supabase, sub, days);
      return {
        ...subToApi(sub),
        quote,
        memberCount: memberCountBySub.get(sub.id!) ?? 0
      };
    })
  );

  return NextResponse.json({ ok: true, watches });
}

/**
 * G1: 一次查 N 個 subscription 的 member 數量。
 * 用 group by 在 supabase client 端 — 撈所有 subscription_id 再 in-mem count，
 * 避免 supabase JS SDK 對 group_by 的支援不太穩。
 */
async function fetchMemberCounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  subIds: number[]
): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  if (subIds.length === 0) return m;
  const { data, error } = await supabase
    .from('group_member')
    .select('subscription_id')
    .in('subscription_id', subIds);
  if (error) {
    console.warn('[with-quotes] member count fetch failed:', error.message);
    return m;
  }
  for (const row of (data ?? []) as { subscription_id: number }[]) {
    m.set(row.subscription_id, (m.get(row.subscription_id) ?? 0) + 1);
  }
  return m;
}

/**
 * 把 DB row 整理成 WatchWithQuote「subscription 部分」(snake_case 保持一致，不 alias)。
 * 顯式列欄位 — 避免 select * 把 internal-only 欄位漏出去（防 future schema changes 跑漏）。
 */
function subToApi(sub: Subscription): Omit<WatchWithQuote, 'quote'> {
  return {
    id: sub.id!,
    source_id: sub.source_id,
    source_type: sub.source_type,
    origin: sub.origin,
    destination: sub.destination,
    outbound_date: sub.outbound_date,
    return_date: sub.return_date,
    max_price: Number(sub.max_price),
    max_price_traditional: sub.max_price_traditional != null ? Number(sub.max_price_traditional) : null,
    active: sub.active,
    paused: sub.paused ?? false,
    label: sub.label ?? null,
    outbound_min_departure_time: sub.outbound_min_departure_time ?? null,
    outbound_max_departure_time: sub.outbound_max_departure_time ?? null,
    return_min_departure_time: sub.return_min_departure_time ?? null,
    return_max_departure_time: sub.return_max_departure_time ?? null,
    created_at: sub.created_at,
    airline_filter: sub.airline_filter ?? null,
    pinned_flight_number: sub.pinned_flight_number ?? null,
    pinned_flight_label: sub.pinned_flight_label ?? null
  };
}

/**
 * 對單筆訂閱跑 3 條 query 撈 quote 原料，呼叫 builder 算結果。
 * sub.outbound_date == null → 不算 quote（這種訂閱是「任何日期」型，沒有具體航線可比） → null
 */
async function computeQuoteForSub(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  sub: Subscription,
  days: number
) {
  if (!sub.outbound_date) return null; // 任何日期型訂閱，本 endpoint 還不支援 — frontend 降級

  const destinations = getCityAirports(sub.destination);
  const now = Date.now();

  // 3 個範圍同時撈（這 3 個 query 都打同一個 table 但條件不同）
  const recent6hSince = new Date(now - SIX_HOURS).toISOString();
  const weekAgoStart = new Date(now - 8 * ONE_DAY).toISOString(); // 7 天前 ±1 天
  const weekAgoEnd = new Date(now - 6 * ONE_DAY).toISOString();
  const historySince = new Date(now - days * ONE_DAY).toISOString();

  const baseFilter = (q: ReturnType<typeof supabase['from']>) => {
    let qq = q
      .eq('origin', sub.origin)
      .in('destination', destinations)
      .eq('outbound_date', sub.outbound_date)
      .eq('stops', 0)
      .not('price', 'is', null);
    qq = sub.return_date == null ? qq.is('return_date', null) : qq.eq('return_date', sub.return_date);
    return qq;
  };

  const [recentRes, weekRes, historyRes] = await Promise.all([
    // recent 6h — 完整 row（要餵給 analyzeFlights）
    baseFilter(supabase.from('flight_quotes').select('*'))
      .gte('queried_at', recent6hSince),
    // 7 天前 ±1 天 — 只要 price（算 weekAgoMin）
    baseFilter(supabase.from('flight_quotes').select('price'))
      .gte('queried_at', weekAgoStart)
      .lt('queried_at', weekAgoEnd),
    // 過去 N 天 — queried_at + price 算每日 min
    baseFilter(supabase.from('flight_quotes').select('queried_at, price'))
      .gte('queried_at', historySince)
  ]);

  // 容錯：query 失敗 → 對應欄位降級為 null/empty，不整支 endpoint 502
  if (recentRes.error) console.warn('[with-quotes] recent err:', recentRes.error.message);
  if (weekRes.error) console.warn('[with-quotes] week err:', weekRes.error.message);
  if (historyRes.error) console.warn('[with-quotes] history err:', historyRes.error.message);

  // === 將 recent rows 分組成 { airport → AirportFlights } ===
  const recentByAirport = new Map<string, AirportFlights>();
  for (const row of (recentRes.data ?? []) as FlightQuote[]) {
    const ap = row.destination;
    let bucket = recentByAirport.get(ap);
    if (!bucket) {
      bucket = { outbound: [], return: [] };
      recentByAirport.set(ap, bucket);
    }
    if (row.trip_leg === 'outbound') bucket.outbound.push(row);
    else if (row.trip_leg === 'return') bucket.return.push(row);
  }

  // === weekAgoMin: 7 天前 ±1 天最低（不分類） ===
  let weekAgoMin: number | null = null;
  for (const r of (weekRes.data ?? []) as { price: number | null }[]) {
    if (r.price == null) continue;
    if (weekAgoMin == null || r.price < weekAgoMin) weekAgoMin = r.price;
  }

  // === daily: group by YYYY-MM-DD，每天取 min ===
  const byDay = new Map<string, number>();
  for (const r of (historyRes.data ?? []) as { queried_at: string; price: number | null }[]) {
    if (r.price == null) continue;
    const day = r.queried_at.slice(0, 10);
    const cur = byDay.get(day);
    if (cur == null || r.price < cur) byDay.set(day, r.price);
  }
  const daily = Array.from(byDay.entries())
    .map(([date, minPrice]) => ({ date, minPrice }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const src: QuoteSourceData = { recentByAirport, weekAgoMin, daily };
  return buildWatchQuote(sub, src);
}
