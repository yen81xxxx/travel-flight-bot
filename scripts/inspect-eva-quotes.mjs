// 一次性 debug 腳本：把 TPE→HND 2027-01-30~2027-02-04 路線抓回來的 outbound 報價列出來，
// 重點看 EVA (89,240) 那筆的細節。執行：node scripts/inspect-eva-quotes.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// 簡易 .env.local 解析（容忍註解、空行、有/無引號、CRLF）
const env = {};
const text = readFileSync('.env.local', 'utf8');
for (const line of text.split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const m = t.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
if (!env.NEXT_PUBLIC_SUPABASE_URL) {
  console.error('Parsed keys:', Object.keys(env));
  process.exit(1);
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await supabase
  .from('flight_quotes')
  .select('airline, airline_code, price, stops, duration_minutes, trip_leg, flight_type, queried_at, raw')
  .eq('origin', 'TPE')
  .eq('destination', 'HND')
  .eq('outbound_date', '2027-01-30')
  .eq('return_date', '2027-02-04')
  .order('queried_at', { ascending: false })
  .limit(50);

if (error) { console.error(error); process.exit(1); }

console.log(`找到 ${data.length} 筆報價（最近一輪查詢）\n`);

// 按 trip_leg 分組
for (const leg of ['outbound', 'return']) {
  const subset = data.filter(d => d.trip_leg === leg);
  console.log(`\n=== ${leg.toUpperCase()} (${subset.length} 筆) ===`);
  for (const q of subset) {
    const dur = q.duration_minutes ? `${Math.floor(q.duration_minutes/60)}h${q.duration_minutes%60}m` : '?';
    const stops = q.stops === 0 ? '直飛' : `${q.stops}停`;
    console.log(`  ${q.airline.padEnd(12)} NT$ ${String(q.price).padStart(7)} | ${stops.padEnd(4)} | ${dur.padEnd(7)} | flight_type=${q.flight_type}`);
  }
}

// EVA 詳細 raw
console.log('\n=== EVA / 長榮 raw flight details ===');
const evaQuotes = data.filter(d => d.airline?.includes('長榮') || d.airline_code === 'BR');
for (const q of evaQuotes) {
  console.log(`\n[${q.trip_leg}] NT$ ${q.price}`);
  const legs = q.raw?.flights ?? [];
  for (const l of legs) {
    console.log(`  ${l.airline} ${l.flight_number ?? ''} | ${l.departure_airport?.id} → ${l.arrival_airport?.id} | ${l.duration ? l.duration + 'min' : '?'}`);
  }
}
