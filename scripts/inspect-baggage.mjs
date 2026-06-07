// 看 SerpApi raw 有沒有行李欄位。Run: node scripts/inspect-baggage.mjs
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

// 抓 1 筆廉航、1 筆傳統當代表
const { data: lcc } = await supabase
  .from('flight_quotes')
  .select('airline, price, trip_leg, raw')
  .or('airline.ilike.%捷星%,airline.ilike.%酷航%')
  .order('queried_at', { ascending: false })
  .limit(2);

const { data: fs } = await supabase
  .from('flight_quotes')
  .select('airline, price, trip_leg, raw')
  .or('airline.ilike.%星宇%,airline.ilike.%長榮%')
  .order('queried_at', { ascending: false })
  .limit(2);

function dumpKeys(obj, depth = 0) {
  if (!obj || typeof obj !== 'object') return;
  const indent = '  '.repeat(depth);
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) {
      console.log(`${indent}${k}: [Array len=${v.length}]`);
      if (v[0] && typeof v[0] === 'object') dumpKeys(v[0], depth + 1);
    } else if (typeof v === 'object' && v !== null) {
      console.log(`${indent}${k}: {object}`);
      dumpKeys(v, depth + 1);
    } else {
      const val = JSON.stringify(v);
      console.log(`${indent}${k}: ${val.length > 100 ? val.slice(0, 100) + '…' : val}`);
    }
  }
}

console.log('=== 廉航 raw 鍵 ===');
for (const q of (lcc ?? [])) {
  console.log(`\n[${q.airline} NT$ ${q.price}]`);
  dumpKeys(q.raw);
}

console.log('\n\n=== 傳統 raw 鍵 ===');
for (const q of (fs ?? [])) {
  console.log(`\n[${q.airline} NT$ ${q.price}]`);
  dumpKeys(q.raw);
}

// extensions 陣列實際內容
console.log('\n\n=== extensions 陣列實際內容 ===');
const all = [...(lcc ?? []), ...(fs ?? [])];
for (const q of all) {
  const exts = q.raw?.flights?.[0]?.extensions;
  console.log(`[${q.airline}] extensions:`);
  if (Array.isArray(exts)) {
    for (const e of exts) console.log(`  • ${e}`);
  } else {
    console.log('  (none)');
  }
}
