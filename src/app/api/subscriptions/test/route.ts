import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase';
import { getLineClient } from '@/lib/line';
import { buildAlertFlex } from '@/lib/flex-message';
import type { Subscription } from '@/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  subscriptionId: z.number(),
  sourceId: z.string()
});

/**
 * 測試發送一則訂閱通知（用範例價格），讓使用者知道訊息長怎樣
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data: sub, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('id', body.subscriptionId)
    .eq('source_id', body.sourceId)
    .maybeSingle();

  if (error || !sub) {
    return NextResponse.json({ ok: false, error: 'Subscription not found' }, { status: 404 });
  }

  const s = sub as Subscription;
  const fakePrice = Math.round(Number(s.max_price) * 0.85);  // 模擬比門檻低 15%
  const today = new Date();
  const outboundDate = s.outbound_date ?? new Date(today.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
  const returnDate = s.return_date ?? new Date(today.getTime() + 34 * 86400_000).toISOString().slice(0, 10);

  try {
    const flex = buildAlertFlex({
      origin: s.origin,
      destination: s.destination,
      outboundDate,
      returnDate,
      cheapestPrice: fakePrice,
      threshold: Number(s.max_price),
      airline: '範例航空（這是測試訊息）',
      sourceId: s.source_id
    });
    const client = getLineClient();
    await client.pushMessage({
      to: s.source_id,
      messages: [
        {
          type: 'text',
          text: '🧪 以下是當這條航線跌破門檻時，你會收到的通知範例：'
        },
        // @ts-expect-error - LINE Bot SDK type mismatch
        flex
      ]
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
