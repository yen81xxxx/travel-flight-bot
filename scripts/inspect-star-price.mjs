// 釐清「星宇 NT$ 16,528」到底是來回 / 單程 / 哪個日期
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
  .select('origin, destination, outbound_date, return_date, airline, price, trip_leg, flight_type, queried_at, raw')
  .or('airline.ilike.%星宇%,airline.ilike.%捷星%')
  .order('queried_at', { ascending: false })
  .limit(20);

console.log('航司 | 路線 | 出發日 | 回程日 | trip_leg | 價格 | leg 內航段 | 來源於');
console.log('─'.repeat(120));

for (const q of data) {
  const legs = q.raw?.flights ?? [];
  const segStr = legs.map(l => `${l.departure_airport?.id}→${l.arrival_airport?.id}`).join(' | ');
  console.log([
    q.airline.padEnd(8),
    `${q.origin}↔${q.destination}`.padEnd(10),
    q.outbound_date,
    q.return_date ?? '單程  ',
    q.trip_leg.padEnd(8),
    `NT$ ${String(q.price).padStart(7)}`,
    segStr.padEnd(14),
    new Date(q.queried_at).toISOString().slice(0, 16)
  ].join(' | '));
}

console.log('\n說明：');
console.log('  trip_leg=outbound：raw 內航段=去程，但 price=「該家航司估算來回總價」');
console.log('  trip_leg=return  ：raw 內航段=回程，price=「outbound+return 配對的精確來回總價」');
