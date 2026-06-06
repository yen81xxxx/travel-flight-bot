// 直接打 SerpApi NRT→TPE 2/4→4/3 (long-stay reverse) 看實際錯誤
// 會用掉 ~1 個 SerpApi 配額
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

const apiKey = env.SERPAPI_KEY;
if (!apiKey) { console.error('SERPAPI_KEY 缺'); process.exit(1); }

async function probe(label, params) {
  const url = `https://serpapi.com/search.json?${new URLSearchParams({
    engine: 'google_flights',
    api_key: apiKey,
    hl: 'zh-tw',
    gl: 'tw',
    currency: 'TWD',
    ...params
  })}`;

  console.log(`\n--- ${label} ---`);
  console.log('URL:', url.replace(apiKey, '<key>'));

  try {
    const resp = await fetch(url, { headers: { Accept: 'application/json' } });
    console.log('Status:', resp.status, resp.statusText);
    const json = await resp.json();
    if (json.error) {
      console.log('SerpApi error:', json.error);
    } else if (json.search_metadata?.status) {
      console.log('Search status:', json.search_metadata.status);
      console.log('best_flights:', json.best_flights?.length ?? 0);
      console.log('other_flights:', json.other_flights?.length ?? 0);
      const all = [...(json.best_flights ?? []), ...(json.other_flights ?? [])];
      console.log('Has departure_token:', all.some(f => f.departure_token));
      if (all[0]) {
        console.log('Sample airline:', all[0].flights?.[0]?.airline, 'price:', all[0].price);
      }
    } else {
      console.log('Unusual response, top keys:', Object.keys(json).slice(0, 10));
    }
  } catch (err) {
    console.log('Fetch threw:', err.message);
  }
}

// 失敗的：NRT → TPE 反向長住
await probe('NRT→TPE 2/4→4/3 (58 天)', {
  departure_id: 'NRT',
  arrival_id: 'TPE',
  outbound_date: '2027-02-04',
  return_date: '2027-04-03',
  type: '1'
});

// 對照：TPE → NRT 同期間正向
await probe('TPE→NRT 2/4→4/3 (58 天 正向)', {
  departure_id: 'TPE',
  arrival_id: 'NRT',
  outbound_date: '2027-02-04',
  return_date: '2027-04-03',
  type: '1'
});

// 對照：能成功的 TPE→HND 1/30→2/4 (5 天)
await probe('TPE→HND 1/30→2/4 (5 天)', {
  departure_id: 'TPE',
  arrival_id: 'HND',
  outbound_date: '2027-01-30',
  return_date: '2027-02-04',
  type: '1'
});
