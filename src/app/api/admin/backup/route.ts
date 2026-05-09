import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 匯出整個 DB 為 JSON
 * 用 ADMIN_PASSWORD 認證
 *
 * 用法：
 *   curl -H "Authorization: Bearer YOUR_ADMIN_PASSWORD" \
 *        https://travel-flight-bot.vercel.app/api/admin/backup > backup.json
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get('authorization');
  const expected = `Bearer ${process.env.ADMIN_PASSWORD ?? ''}`;
  if (!process.env.ADMIN_PASSWORD || auth !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const supabase = getSupabase();

  // 抓所有表的全部資料（小資料量適用，量大要改 stream）
  const [subs, settings, runs, quotes, notifs] = await Promise.all([
    supabase.from('subscriptions').select('*'),
    supabase.from('notification_settings').select('*'),
    supabase.from('search_runs').select('*').order('started_at', { ascending: false }).limit(5000),
    supabase.from('flight_quotes').select('*').order('queried_at', { ascending: false }).limit(20000),
    supabase.from('notifications').select('*').order('sent_at', { ascending: false }).limit(5000)
  ]);

  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    subscriptions: subs.data ?? [],
    notification_settings: settings.data ?? [],
    search_runs: runs.data ?? [],
    flight_quotes: quotes.data ?? [],
    notifications: notifs.data ?? [],
    counts: {
      subscriptions: subs.data?.length ?? 0,
      notification_settings: settings.data?.length ?? 0,
      search_runs: runs.data?.length ?? 0,
      flight_quotes: quotes.data?.length ?? 0,
      notifications: notifs.data?.length ?? 0
    }
  };

  // 檔名：travel-flight-bot-backup-2026-05-08.json
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(backup, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="travel-flight-bot-backup-${date}.json"`
    }
  });
}
