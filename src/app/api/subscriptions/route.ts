import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase';
import { TW_ORIGINS, JP_DESTINATIONS } from '@/config/airports';
import type { SourceType } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_ORIGINS = TW_ORIGINS.map(a => a.iata);
const VALID_DESTINATIONS = JP_DESTINATIONS.map(a => a.iata);

const PostBody = z.object({
  sourceId: z.string().min(1),
  origin: z.enum(VALID_ORIGINS as [string, ...string[]]),
  destination: z.enum(VALID_DESTINATIONS as [string, ...string[]]),
  maxPrice: z.number().positive(),
  outboundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  label: z.string().optional()
});

/** 列出某個 sourceId 的訂閱 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const sourceId = req.nextUrl.searchParams.get('sourceId');
  if (!sourceId) {
    return NextResponse.json(
      { ok: false, error: 'sourceId required' },
      { status: 400 }
    );
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('source_id', sourceId)
    .eq('active', true)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, subscriptions: data ?? [] });
}

/** 建立新訂閱 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: z.infer<typeof PostBody>;
  try {
    body = PostBody.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'Invalid body', details: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }

  const sourceType = inferSourceType(body.sourceId);
  const supabase = getSupabase();

  // 同樣的訂閱已存在就更新 max_price
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('id, max_price')
    .eq('source_id', body.sourceId)
    .eq('origin', body.origin)
    .eq('destination', body.destination)
    .eq('active', true)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('subscriptions')
      .update({
        max_price: body.maxPrice,
        outbound_date: body.outboundDate ?? null,
        return_date: body.returnDate ?? null,
        label: body.label ?? null
      })
      .eq('id', existing.id);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      action: 'updated',
      id: existing.id,
      previousMaxPrice: existing.max_price
    });
  }

  const { data, error } = await supabase
    .from('subscriptions')
    .insert({
      source_id: body.sourceId,
      source_type: sourceType,
      origin: body.origin,
      destination: body.destination,
      outbound_date: body.outboundDate ?? null,
      return_date: body.returnDate ?? null,
      max_price: body.maxPrice,
      label: body.label ?? null
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, action: 'created', subscription: data });
}

/** 取消訂閱（軟刪除） */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const idStr = req.nextUrl.searchParams.get('id');
  const sourceId = req.nextUrl.searchParams.get('sourceId');
  if (!idStr || !sourceId) {
    return NextResponse.json(
      { ok: false, error: 'id and sourceId required' },
      { status: 400 }
    );
  }
  const id = parseInt(idStr, 10);
  if (isNaN(id)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { error } = await supabase
    .from('subscriptions')
    .update({ active: false })
    .eq('id', id)
    .eq('source_id', sourceId);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

function inferSourceType(sourceId: string): SourceType {
  if (sourceId.startsWith('U')) return 'user';
  if (sourceId.startsWith('C')) return 'group';
  if (sourceId.startsWith('R')) return 'room';
  return 'user';
}
