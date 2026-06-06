// 看為何 cron 自以為 cache 命中 — 對 NRT→TPE 2027-02-04~2027-04-03 看 quote 時序
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

// 對「日本→台灣」的 4 條路線，看最近 7 天每天有沒有 quote 進來
const routes = [
  { origin: 'NRT', destination: 'TPE', outbound_date: '2027-02-04', return_date: '2027-04-03' },
  { origin: 'NRT', destination: 'TPE', outbound_date: '2027-02-04', return_date: '2027-04-04' },
  { origin: 'SDJ', destination: 'TPE', outbound_date: '2027-02-04', return_date: '2027-04-03' },
  { origin: 'SDJ', destination: 'TPE', outbound_date: '2027-02-04', return_date: '2027-04-04' },
  { origin: 'TPE', destination: 'HND', outbound_date: '2027-01-30', return_date: '2027-02-04' }
];

for (const r of routes) {
  const { data } = await supabase
    .from('flight_quotes')
    .select('queried_at, stops, trip_leg, airline, price')
    .eq('origin', r.origin)
    .eq('destination', r.destination)
    .eq('outbound_date', r.outbound_date)
    .eq('return_date', r.return_date)
    .gte('queried_at', '2026-05-30T00:00:00Z')
    .order('queried_at', { ascending: false });

  // 按 query 時間 batch（同一秒/分內視為一次 cron 寫入）
  const batches = new Map();
  for (const q of (data ?? [])) {
    const ts = q.queried_at.slice(0, 16);  // YYYY-MM-DDTHH:MM
    const arr = batches.get(ts) ?? [];
    arr.push(q);
    batches.set(ts, arr);
  }

  console.log(`\n${r.origin}→${r.destination} ${r.outbound_date}~${r.return_date} 的 cron 寫入時序：`);
  for (const [ts, arr] of [...batches].sort((a, b) => b[0].localeCompare(a[0]))) {
    const direct = arr.filter(x => x.stops === 0);
    const lcc = direct.filter(x => x.airline?.match(/捷星|酷航/)).length;
    const trad = direct.filter(x => x.airline?.match(/星宇|長榮/)).length;
    const out = direct.filter(x => x.trip_leg === 'outbound').length;
    const ret = direct.filter(x => x.trip_leg === 'return').length;
    console.log(`  ${ts}: ${arr.length} 筆（直飛 ${direct.length}: out=${out} ret=${ret} | lcc=${lcc} trad=${trad}）`);
  }
}
