import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const PostBody = z.object({
  sourceId: z.string().min(1),
  quietStart: z.string().regex(TIME_RE).nullable(),
  quietEnd: z.string().regex(TIME_RE).nullable(),
  timezone: z.string().default('Asia/Taipei'),
  dailySummary: z.boolean().optional(),
  priceAlerts: z.boolean().optional(),
  // PR #4b 新增：群組情境下，新追蹤的預設通知對象 ('me' = 個人 / 'group' = 群組)
  // 對應 migration 0008。'me' 預設不會誤打擾群組。
  defaultNotifyTarget: z.enum(['me', 'group']).optional()
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  const sourceId = req.nextUrl.searchParams.get('sourceId');
  if (!sourceId) {
    return NextResponse.json({ ok: false, error: 'sourceId required' }, { status: 400 });
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('notification_settings')
    .select('*')
    .eq('source_id', sourceId)
    .maybeSingle();
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, settings: data });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: z.infer<typeof PostBody>;
  try {
    body = PostBody.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const supabase = getSupabase();
  const upsertRow: Record<string, unknown> = {
    source_id: body.sourceId,
    quiet_start: body.quietStart,
    quiet_end: body.quietEnd,
    timezone: body.timezone,
    updated_at: new Date().toISOString()
  };
  if (body.dailySummary !== undefined) upsertRow.daily_summary = body.dailySummary;
  if (body.priceAlerts !== undefined) upsertRow.price_alerts = body.priceAlerts;
  if (body.defaultNotifyTarget !== undefined) upsertRow.default_notify_target = body.defaultNotifyTarget;

  const { error } = await supabase
    .from('notification_settings')
    .upsert(upsertRow, { onConflict: 'source_id' });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
