import { getSupabase } from './supabase';

interface CleanupResult {
  flightQuotesDeleted: number;
  searchRunsDeleted: number;
  notificationsDeleted: number;
}

/**
 * 清掉舊的歷史資料，避免 DB 無限長大。
 * - flight_quotes: 30 天前
 * - search_runs: 90 天前
 * - notifications: 365 天前
 */
export async function cleanupOldRecords(): Promise<CleanupResult> {
  const supabase = getSupabase();

  const days = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

  const result: CleanupResult = {
    flightQuotesDeleted: 0,
    searchRunsDeleted: 0,
    notificationsDeleted: 0
  };

  try {
    const { count } = await supabase
      .from('flight_quotes')
      .delete({ count: 'exact' })
      .lt('queried_at', days(30));
    result.flightQuotesDeleted = count ?? 0;
  } catch (e) {
    console.error('[cleanup] flight_quotes failed:', e);
  }

  try {
    const { count } = await supabase
      .from('search_runs')
      .delete({ count: 'exact' })
      .lt('started_at', days(90));
    result.searchRunsDeleted = count ?? 0;
  } catch (e) {
    console.error('[cleanup] search_runs failed:', e);
  }

  try {
    const { count } = await supabase
      .from('notifications')
      .delete({ count: 'exact' })
      .lt('sent_at', days(365));
    result.notificationsDeleted = count ?? 0;
  } catch (e) {
    console.error('[cleanup] notifications failed:', e);
  }

  return result;
}

interface QuotaStats {
  thisMonth: number;        // 本月實際 SerpApi 呼叫次數（status != 'cached'）
  cachedHits: number;       // 本月命中快取次數
  estimatedRemaining: number; // 估算剩餘額度（假設 250/月）
}

/**
 * 統計本月 SerpApi 用量
 */
export async function getQuotaStats(monthlyLimit = 250): Promise<QuotaStats> {
  const supabase = getSupabase();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const { data: runs } = await supabase
    .from('search_runs')
    .select('status, serpapi_calls')
    .gte('started_at', startOfMonth.toISOString());

  const allRuns = runs ?? [];
  let calls = 0;
  let cached = 0;
  for (const r of allRuns) {
    if (r.status === 'cached') {
      cached++;
    } else {
      calls += r.serpapi_calls ?? 0;
    }
  }

  return {
    thisMonth: calls,
    cachedHits: cached,
    estimatedRemaining: Math.max(0, monthlyLimit - calls)
  };
}
