import { createClient, SupabaseClient } from '@supabase/supabase-js';

let cachedClient: SupabaseClient | null = null;

/**
 * Server-side Supabase client (uses service role key, bypasses RLS).
 * Only use this in API routes / server components — never ship the key to the browser.
 */
export function getSupabase(): SupabaseClient {
  if (cachedClient) return cachedClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      'Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
    );
  }

  cachedClient = createClient(url, serviceKey, {
    auth: { persistSession: false },
    global: {
      // ⚠️ 關鍵：Next.js App Router 預設會把 GET fetch 存進 Data Cache。
      // supabase-js 的 select() 底層就是 GET → 同一個 query URL 在寫入後仍回傳
      // 快取的舊資料（刪除/編輯後 with-quotes 還看得到舊訂閱、卡片跑回來）。
      // route 的 dynamic='force-dynamic' 擋不到 supabase 內部這層 fetch。
      // 強制 no-store → 每次查詢都打到 DB 拿最新，杜絕 stale read。
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' })
    }
  });
  return cachedClient;
}
