// 為何「查無資料」？檢查訂閱與最近抓到的 flight_quotes
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const m = t.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

// 1) 列出所有 active 訂閱
const { data: subs } = await supabase
  .from('subscriptions')
  .select('id, source_id, source_type, origin, destination, outbound_date, return_date, max_price, max_price_traditional, outbound_min_departure_time, return_min_departure_time, outbound_max_departure_time, return_max_departure_time, label, active, paused, created_at')
  .eq('active', true)
  .order('source_id, origin, outbound_date');

console.log(`=== 全部 active 訂閱 (${subs?.length ?? 0} 筆) ===\n`);
for (const s of (subs ?? [])) {
  const flags = [];
  if (s.paused) flags.push('PAUSED');
  if (s.outbound_min_departure_time || s.outbound_max_departure_time
    || s.return_min_departure_time || s.return_max_departure_time) {
    flags.push(`time-filter:去[${s.outbound_min_departure_time ?? '*'}-${s.outbound_max_departure_time ?? '*'}]/回[${s.return_min_departure_time ?? '*'}-${s.return_max_departure_time ?? '*'}]`);
  }
  console.log([
    `#${s.id}`.padEnd(6),
    s.source_type.padEnd(5),
    `${s.origin}→${s.destination}`.padEnd(10),
    `${s.outbound_date ?? '????'} ~ ${s.return_date ?? '????'}`,
    `tgt:NT$${s.max_price}${s.max_price_traditional != null ? '/'+s.max_price_traditional : ''}`,
    flags.join(' ')
  ].join(' | '));
}

// 2) 對每筆 sub 看「全部時段 flight_quotes 有沒有資料」（沒設下限）
console.log('\n\n=== 每條訂閱對應的 flight_quotes 統計（全部時段）===\n');
const newerThan = '2020-01-01T00:00:00Z';

// 同城多機場 fan-out 對應
const MULTI = { '東京': ['HND', 'NRT'] };
const CITY = { HND: '東京', NRT: '東京' };

for (const s of (subs ?? [])) {
  const city = CITY[s.destination];
  const destAirports = city ? MULTI[city] : [s.destination];
  const { data: q, error } = await supabase
    .from('flight_quotes')
    .select('origin, destination, airline, trip_leg, price, queried_at, stops')
    .eq('origin', s.origin)
    .in('destination', destAirports)
    .eq('outbound_date', s.outbound_date)
    .eq('return_date', s.return_date)
    .gte('queried_at', newerThan)
    .order('queried_at', { ascending: false })
    .limit(20);

  const got = q?.length ?? 0;
  console.log(`#${s.id} ${s.origin}→${s.destination} (${destAirports.join(',')}) ${s.outbound_date}~${s.return_date}: ${got} 筆`);
  if (got > 0) {
    // 直飛
    const direct = q.filter(x => x.stops === 0);
    const airlines = new Set(direct.map(x => x.airline));
    console.log(`   直飛 ${direct.length} 筆，航司：${[...airlines].join(', ')}`);
    const minLcc = Math.min(...direct.filter(x => x.airline?.match(/捷星|酷航/)).map(x => x.price ?? Infinity));
    const minTrad = Math.min(...direct.filter(x => x.airline?.match(/星宇|長榮/)).map(x => x.price ?? Infinity));
    console.log(`   廉航最低: ${isFinite(minLcc) ? 'NT$ '+minLcc : '(無)'}, 傳統最低: ${isFinite(minTrad) ? 'NT$ '+minTrad : '(無)'}`);
  }
  if (error) console.log(`   err:`, error.message);
}

// 3) 本月配額
console.log('\n\n=== 本月 SerpApi 用量 ===');
const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
const { data: monthRuns } = await supabase
  .from('search_runs')
  .select('serpapi_calls, status')
  .gte('started_at', startOfMonth);
const monthCalls = (monthRuns ?? []).reduce((s, r) => s + (r.serpapi_calls ?? 0), 0);
console.log(`本月已用 ${monthCalls} / 250 (估計剩餘 ${Math.max(0, 250 - monthCalls)})`);

// 3') 最近的 search_runs 看 cron 跑得如何
console.log('\n\n=== 最近 5 次 cron 執行 ===\n');
const { data: runs } = await supabase
  .from('search_runs')
  .select('id, triggered_by, status, started_at, duration_ms, serpapi_calls, error_message')
  .order('started_at', { ascending: false })
  .limit(5);
for (const r of (runs ?? [])) {
  console.log([
    new Date(r.started_at).toISOString().slice(0, 16),
    r.triggered_by.padEnd(6),
    r.status.padEnd(8),
    `${r.duration_ms}ms`.padEnd(8),
    `${r.serpapi_calls} calls`.padEnd(10),
    r.error_message ?? ''
  ].join(' | '));
}
