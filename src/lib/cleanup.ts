import { getSupabase } from './supabase';

// ===== 清理配置 =====
const RETENTION_DAYS = {
  FLIGHT_QUOTES: 30,
  SEARCH_RUNS: 90,
  NOTIFICATIONS: 365
} as const;

interface CleanupResult {
  flightQuotesDeleted: number;
  searchRunsDeleted: number;
  notificationsDeleted: number;
}

/**
 * 將天數轉換為 ISO 時間戳（過去 N 天）
 */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

/**
 * 通用的刪除函數（帶重試邏輯）
 */
async function deleteOldRecords(
  tableName: string,
  dateColumnName: string,
  retentionDays: number
): Promise<number> {
  const supabase = getSupabase();
  try {
    const { count } = await supabase
      .from(tableName)
      .delete({ count: 'exact' })
      .lt(dateColumnName, daysAgo(retentionDays));
    return count ?? 0;
  } catch (e) {
    console.error(`[cleanup] ${tableName} failed:`, e);
    return 0;
  }
}

/**
 * 清掉舊的歷史資料，避免 DB 無限長大。
 * - flight_quotes: 30 天前
 * - search_runs: 90 天前
 * - notifications: 365 天前
 */
export async function cleanupOldRecords(): Promise<CleanupResult> {
  const [flightQuotesDeleted, searchRunsDeleted, notificationsDeleted] = await Promise.all([
    deleteOldRecords('flight_quotes', 'queried_at', RETENTION_DAYS.FLIGHT_QUOTES),
    deleteOldRecords('search_runs', 'started_at', RETENTION_DAYS.SEARCH_RUNS),
    deleteOldRecords('notifications', 'sent_at', RETENTION_DAYS.NOTIFICATIONS)
  ]);

  return {
    flightQuotesDeleted,
    searchRunsDeleted,
    notificationsDeleted
  };
}

interface QuotaStats {
  thisMonth: number;        // 本月實際 SerpApi 呼叫次數（status != 'cached'）
  cachedHits: number;       // 本月命中快取次數
  estimatedRemaining: number; // 估算剩餘額度（假設 250/月）
}

/**
 * 計算本月開始的 ISO 時間戳
 */
function getStartOfMonth(): string {
  const date = new Date();
  date.setDate(1);
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

/**
 * 統計本月 SerpApi 用量
 */
export async function getQuotaStats(monthlyLimit = 250): Promise<QuotaStats> {
  const supabase = getSupabase();
  const { data: runs } = await supabase
    .from('search_runs')
    .select('status, serpapi_calls')
    .gte('started_at', getStartOfMonth());

  const allRuns = runs ?? [];
  const { calls, cached } = allRuns.reduce(
    (acc, r) => ({
      calls: acc.calls + (r.status === 'cached' ? 0 : r.serpapi_calls ?? 0),
      cached: acc.cached + (r.status === 'cached' ? 1 : 0)
    }),
    { calls: 0, cached: 0 }
  );

  return {
    thisMonth: calls,
    cachedHits: cached,
    estimatedRemaining: Math.max(0, monthlyLimit - calls)
  };
}
