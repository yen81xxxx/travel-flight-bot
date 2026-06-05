// 一次性 debug：從 flight_quotes 抽樣，驗證 raw.flights[0].departure_airport.time
// 真的長 'YYYY-MM-DD HH:MM' 格式（給 extractDepartureHHMM 用）。
// Run: node scripts/inspect-time-format.mjs
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data, error } = await supabase
  .from('flight_quotes')
  .select('airline, trip_leg, raw')
  .order('queried_at', { ascending: false })
  .limit(50);

if (error) { console.error(error); process.exit(1); }

console.log(`抽樣 ${data.length} 筆\n`);

let format_yyyy_mm_dd = 0;
let format_other = 0;
let no_time = 0;
const samples = new Set();

for (const q of data) {
  const time = q.raw?.flights?.[0]?.departure_airport?.time;
  if (typeof time !== 'string') { no_time++; continue; }
  samples.add(time);
  // 我們的 regex 是 \b(\d{2}:\d{2})\b — 任意位置抓 HH:MM
  // 真實格式應該是 'YYYY-MM-DD HH:MM'
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(time)) format_yyyy_mm_dd++;
  else format_other++;
}

console.log('格式統計：');
console.log(`  'YYYY-MM-DD HH:MM' → ${format_yyyy_mm_dd}`);
console.log(`  其他格式            → ${format_other}`);
console.log(`  無 time 欄位        → ${no_time}\n`);

console.log('實際樣本（去重，至多 20）：');
const arr = Array.from(samples).slice(0, 20);
for (const s of arr) console.log(`  "${s}"`);

// 用 regex 跑一遍模擬 extractDepartureHHMM
console.log('\n模擬 extractDepartureHHMM 抽出來的 HH:MM：');
const extracted = new Set();
for (const s of samples) {
  const m = s.match(/\b(\d{2}:\d{2})\b/);
  if (m) extracted.add(m[1]);
  else extracted.add(`<MISS: ${s}>`);
}
console.log(`  ${Array.from(extracted).sort().join(', ')}`);
