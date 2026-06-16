import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { PostBody, buildSettingsUpsert } from './schema';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
  let upsertRow: Record<string, unknown>;
  try {
    upsertRow = buildSettingsUpsert(PostBody.parse(await req.json()));
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const supabase = getSupabase();

  const { error } = await supabase
    .from('notification_settings')
    .upsert(upsertRow, { onConflict: 'source_id' });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
