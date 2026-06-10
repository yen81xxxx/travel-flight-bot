/**
 * /api/group-watch/[id] — group watch 對單一 subscription 的 join / leave / 看成員
 *
 * G1 三個動作集中在一個 dynamic route：
 *   - GET    /api/group-watch/[id]              → 列出 member 清單
 *   - POST   /api/group-watch/[id]              → body.action: 'join' | 'leave' (idempotent)
 *
 * 為何用 body action 不用 path：Next.js App Router dynamic route 不會把
 * /[id]/join 視為同一個 route.ts handler；分開檔案要再開兩個 route.ts，
 * 程式量爆炸而且 code duplication。Body action 較精簡。
 *
 * Idempotent 是重點：用戶可能重複點按鈕 / network retry，不該因為「已經加入」就 500。
 *
 * 安全考量：
 *   - userId 是 caller 自己宣稱的（沒驗 id-token），跟既有 /api/subscriptions 相同
 *     pattern；G4 之後可加 id-token 驗證一次性強化。
 *   - subscription_id 必須 source_type='group'，個人訂閱拒絕（避免亂寫 group_member）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  action: z.enum(['join', 'leave']),
  userId: z.string().min(1),
  displayName: z.string().optional()
});

/** GET — 列出某 group watch 的所有 member */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const subId = parseInt(params.id, 10);
  if (isNaN(subId)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('group_member')
    .select('line_user_id, display_name, accepted_target, joined_at')
    .eq('subscription_id', subId)
    .order('joined_at', { ascending: true });
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, members: data ?? [] });
}

/** POST — body.action 區分 join / leave */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const subId = parseInt(params.id, 10);
  if (isNaN(subId)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }
  const action = body.action;

  const supabase = getSupabase();

  // 防呆：subscription 必須是 group watch 才能加 member
  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .select('id, source_type')
    .eq('id', subId)
    .maybeSingle();
  if (subErr) {
    return NextResponse.json({ ok: false, error: subErr.message }, { status: 500 });
  }
  if (!sub) {
    return NextResponse.json({ ok: false, error: 'subscription not found' }, { status: 404 });
  }
  if (sub.source_type !== 'group') {
    return NextResponse.json(
      { ok: false, error: 'only group subscriptions accept members' },
      { status: 400 }
    );
  }

  if (action === 'join') {
    // Upsert by unique (subscription_id, line_user_id) — idempotent
    const { error } = await supabase
      .from('group_member')
      .upsert(
        {
          subscription_id: subId,
          line_user_id: body.userId,
          display_name: body.displayName ?? null
        },
        { onConflict: 'subscription_id,line_user_id', ignoreDuplicates: false }
      );
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, action: 'joined' });
  }

  // action === 'leave'
  const { error } = await supabase
    .from('group_member')
    .delete()
    .eq('subscription_id', subId)
    .eq('line_user_id', body.userId);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, action: 'left' });
}
