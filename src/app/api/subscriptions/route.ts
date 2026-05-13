import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase';
import { ALL_AIRPORTS, isTaiwanAirport, isJapanAirport, formatAirport } from '@/config/airports';
import { pushText } from '@/lib/line';
import type { SourceType } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_IATA = ALL_AIRPORTS.map(a => a.iata);

const PostBody = z.object({
  sourceId: z.string().min(1),
  origin: z.enum(VALID_IATA as [string, ...string[]]),
  destination: z.enum(VALID_IATA as [string, ...string[]]),
  maxPrice: z.number().positive(),
  outboundDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  label: z.string().optional()
}).refine(
  (data) => {
    const tw1 = isTaiwanAirport(data.origin);
    const jp1 = isJapanAirport(data.origin);
    const tw2 = isTaiwanAirport(data.destination);
    const jp2 = isJapanAirport(data.destination);
    return (tw1 && jp2) || (jp1 && tw2);
  },
  { message: '出發地與目的地必須一個在台灣、一個在日本' }
);

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
  // dedup key = source + origin + destination + outbound_date + return_date
  // 不同日期視為不同訂閱（讓使用者能追蹤多個日期區間）
  let dedupQuery = supabase
    .from('subscriptions')
    .select('id, max_price')
    .eq('source_id', body.sourceId)
    .eq('origin', body.origin)
    .eq('destination', body.destination)
    .eq('active', true);

  if (body.outboundDate) {
    dedupQuery = dedupQuery.eq('outbound_date', body.outboundDate);
  } else {
    dedupQuery = dedupQuery.is('outbound_date', null);
  }
  if (body.returnDate) {
    dedupQuery = dedupQuery.eq('return_date', body.returnDate);
  } else {
    dedupQuery = dedupQuery.is('return_date', null);
  }

  const { data: existing } = await dedupQuery.maybeSingle();

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
    // 推確認訊息（更新門檻）
    await safePush(body.sourceId, formatConfirm({
      action: 'updated',
      origin: body.origin,
      destination: body.destination,
      outboundDate: body.outboundDate,
      returnDate: body.returnDate,
      maxPrice: body.maxPrice,
      isGroup: sourceType !== 'user',
      previousMaxPrice: Number(existing.max_price),
      sourceId: body.sourceId
    }));
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
      label: body.label ?? null,
      paused: false
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  // 推確認訊息（新建）
  await safePush(body.sourceId, formatConfirm({
    action: 'created',
    origin: body.origin,
    destination: body.destination,
    outboundDate: body.outboundDate,
    returnDate: body.returnDate,
    maxPrice: body.maxPrice,
    isGroup: sourceType !== 'user',
    sourceId: body.sourceId
  }));
  return NextResponse.json({ ok: true, action: 'created', subscription: data });
}

interface ConfirmProps {
  action: 'created' | 'updated';
  origin: string;
  destination: string;
  outboundDate?: string;
  returnDate?: string;
  maxPrice: number;
  isGroup: boolean;
  previousMaxPrice?: number;
  sourceId: string;
}

function formatConfirm(p: ConfirmProps): string {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://travel-flight-bot.vercel.app';
  const subsUrl = p.isGroup
    ? `${appUrl}/liff/subscriptions?ctx=${encodeURIComponent(p.sourceId)}`
    : `${appUrl}/liff/subscriptions`;

  const lines: string[] = [];
  lines.push(p.action === 'created' ? '✅ 訂閱建立成功' : '✅ 訂閱已更新');
  lines.push('');
  lines.push(`✈️ ${formatAirport(p.origin)} → ${formatAirport(p.destination)}`);
  if (p.outboundDate && p.returnDate) {
    lines.push(`📅 ${p.outboundDate} ~ ${p.returnDate}`);
  } else {
    lines.push('📅 不限定日期（任何時段都監控）');
  }
  if (p.action === 'updated' && p.previousMaxPrice != null) {
    lines.push(`🎯 門檻：NT$ ${p.previousMaxPrice.toLocaleString()} → NT$ ${p.maxPrice.toLocaleString()}`);
  } else {
    lines.push(`🎯 跌破 NT$ ${p.maxPrice.toLocaleString()} 通知${p.isGroup ? '整個群組' : '你'}`);
  }
  lines.push('');
  lines.push(`📋 管理${p.isGroup ? '此群組' : '你的'}訂閱：`);
  lines.push(subsUrl);
  return lines.join('\n');
}

async function safePush(sourceId: string, text: string): Promise<void> {
  try {
    await pushText(sourceId, text);
  } catch (e) {
    console.warn('[subscriptions] push confirm failed:', e);
  }
}

/**
 * 部分更新訂閱（暫停、備註）
 * body: { id, sourceId, paused?, label?, maxPrice? }
 */
const PatchBody = z.object({
  id: z.number(),
  sourceId: z.string(),
  paused: z.boolean().optional(),
  label: z.string().nullable().optional(),
  maxPrice: z.number().positive().optional()
});
export async function PATCH(req: NextRequest): Promise<NextResponse> {
  let body: z.infer<typeof PatchBody>;
  try {
    body = PatchBody.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const supabase = getSupabase();
  const update: Record<string, unknown> = {};
  if (body.paused !== undefined) update.paused = body.paused;
  if (body.label !== undefined) update.label = body.label;
  if (body.maxPrice !== undefined) update.max_price = body.maxPrice;

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: false, error: 'no fields to update' }, { status: 400 });
  }

  const { error } = await supabase
    .from('subscriptions')
    .update(update)
    .eq('id', body.id)
    .eq('source_id', body.sourceId);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
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
