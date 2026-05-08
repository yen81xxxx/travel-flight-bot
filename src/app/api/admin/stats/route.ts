import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { getQuotaStats } from '@/lib/cleanup';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 系統統計（admin 專用，需要密碼）
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get('authorization');
  const expected = `Bearer ${process.env.ADMIN_PASSWORD ?? ''}`;
  if (!process.env.ADMIN_PASSWORD || auth !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();

  // 並行查詢各項統計
  const [
    subsActive,
    subsTotal,
    uniqueUsers,
    quotesCount,
    runsLast7d,
    runsFailed,
    notifsLast30d,
    quota
  ] = await Promise.all([
    supabase.from('subscriptions').select('*', { count: 'exact', head: true }).eq('active', true),
    supabase.from('subscriptions').select('*', { count: 'exact', head: true }),
    supabase.from('subscriptions').select('source_id').eq('active', true),
    supabase.from('flight_quotes').select('*', { count: 'exact', head: true }),
    supabase.from('search_runs').select('*', { count: 'exact', head: true })
      .gte('started_at', new Date(Date.now() - 7 * 86400_000).toISOString()),
    supabase.from('search_runs').select('*', { count: 'exact', head: true })
      .eq('status', 'failed')
      .gte('started_at', new Date(Date.now() - 7 * 86400_000).toISOString()),
    supabase.from('notifications').select('*', { count: 'exact', head: true })
      .gte('sent_at', new Date(Date.now() - 30 * 86400_000).toISOString()),
    getQuotaStats()
  ]);

  // 熱門路線統計
  const { data: topRoutes } = await supabase
    .from('subscriptions')
    .select('origin, destination')
    .eq('active', true);

  const routeCount = new Map<string, number>();
  for (const r of (topRoutes ?? [])) {
    const key = `${r.origin}→${r.destination}`;
    routeCount.set(key, (routeCount.get(key) ?? 0) + 1);
  }
  const topRoutesList = [...routeCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([route, count]) => ({ route, count }));

  // 最近錯誤
  const { data: recentErrors } = await supabase
    .from('search_runs')
    .select('id, origin, destination, error_message, started_at')
    .eq('status', 'failed')
    .order('started_at', { ascending: false })
    .limit(10);

  const userIds = new Set<string>();
  for (const u of (uniqueUsers.data ?? [])) {
    userIds.add(u.source_id);
  }

  return NextResponse.json({
    ok: true,
    stats: {
      activeSubscriptions: subsActive.count ?? 0,
      totalSubscriptions: subsTotal.count ?? 0,
      uniqueUsers: userIds.size,
      cachedQuotes: quotesCount.count ?? 0,
      runsLast7d: runsLast7d.count ?? 0,
      runsFailedLast7d: runsFailed.count ?? 0,
      notifsLast30d: notifsLast30d.count ?? 0
    },
    quota,
    topRoutes: topRoutesList,
    recentErrors: recentErrors ?? []
  });
}
