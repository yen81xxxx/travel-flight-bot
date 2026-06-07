// 看 TPE ↔ NRT 1/30 → 2/4 這條的長榮 / 星宇實際歷史報價
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

const { data } = await supabase
  .from('flight_quotes')
  .select('origin, destination, outbound_date, return_date, airline, price, trip_leg, raw, queried_at')
  .or('airline.ilike.%星宇%,airline.ilike.%長榮%,airline.ilike.%捷星%,airline.ilike.%酷航%')
  .eq('outbound_date', '2027-01-30')
  .eq('return_date', '2027-02-04')
  .order('price', { ascending: true });

if (!data || data.length === 0) {
  console.log('沒有 1/30 → 2/4 這條的歷史報價');
  process.exit(0);
}

console.log(`找到 ${data.length} 筆 1/30 → 2/4 報價\n`);

// 按 airline + trip_leg 分組
const byCat = new Map();
for (const q of data) {
  const isTrad = q.airline?.includes('星宇') || q.airline?.includes('長榮');
  const cat = isTrad ? 'TRAD' : 'LCC';
  const key = `${cat}|${q.trip_leg}`;
  const arr = byCat.get(key) ?? [];
  arr.push(q);
  byCat.set(key, arr);
}

for (const [key, arr] of byCat) {
  const [cat, leg] = key.split('|');
  console.log(`\n=== ${cat} ${leg} (${arr.length} 筆) — 由便宜到貴 ===`);
  for (const q of arr.slice(0, 5)) {
    const firstLeg = q.raw?.flights?.[0];
    const dep = firstLeg?.departure_airport;
    const arr2 = firstLeg?.arrival_airport;
    console.log([
      `NT$ ${String(q.price).padStart(7)}`,
      `${q.origin}→${q.destination}`.padEnd(8),
      `${dep?.id} ${dep?.time?.slice(-5)} → ${arr2?.id} ${arr2?.time?.slice(-5)}`,
      `${q.airline}`,
      firstLeg?.flight_number ?? ''
    ].join(' | '));
  }
}
