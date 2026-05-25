import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Read-only 偵錯：列出最近 24h 建立的訂閱，看 source_id 是 user (U…) 還是 group (C…/R…)。
 * 用 CRON_SECRET 認證。
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const supabase = getSupabase();
  const { searchParams } = new URL(req.url);
  const days = parseInt(searchParams.get('days') ?? '7', 10);  // 預設 7 天，可 ?days=365 撈全部
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabase
    .from('subscriptions')
    .select('id, source_id, origin, destination, outbound_date, return_date, max_price, label, active, paused, created_at')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const items = (data ?? []).map(s => ({
    ...s,
    source_type: s.source_id?.startsWith('U') ? 'user (個人)'
      : s.source_id?.startsWith('C') ? 'group (群組)'
      : s.source_id?.startsWith('R') ? 'room (聊天室)'
      : 'unknown',
    source_masked: s.source_id ? s.source_id.slice(0, 8) + '…' : null
  }));

  return NextResponse.json({ ok: true, count: items.length, subscriptions: items });
}
