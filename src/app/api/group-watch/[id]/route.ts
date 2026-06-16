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
 * ⚠️ SECURITY — 已知限制（產品決策 2026-06-16：先不修，記錄就好）
 *   userId 是 caller 自己宣稱的，**沒有驗證 LIFF id-token**。理論上有人猜到群組
 *   訂閱的數字 subId 就能：join 任意群組、進而 set-target 改該群門檻、投票/刪選項。
 *   （set-target/vote/remove 已要求先是 member；但 join 無前置條件 = 缺口。）
 *
 *   為何先不修：這是給朋友用的小工具，攻擊者要先進到本 LIFF、猜 subId、還要知道
 *   受害者 userId 才能冒名，威脅模型風險低。對外開放或出問題前不值得加 id-token
 *   驗證的延遲與複雜度。
 *
 *   日後要修：前端送 liff.getIDToken() → 後端打 LINE verify endpoint 取真實 userId
 *   （sub claim）取代自宣稱值；或輕量版用 Messaging API getGroupMemberProfile 確認
 *   userId 真的在該 LINE 群組才准 join。需設 LINE Login channel ID。
 *
 *   防呆（現有）：subscription_id 必須 source_type='group'，個人訂閱拒絕。
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase';
import { computeDerivedTarget, type ConsensusRule } from '@/lib/group-consensus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BodySchema = z.object({
  // G1: join / leave；G2 加 set-target
  action: z.enum(['join', 'leave', 'set-target']),
  userId: z.string().min(1),
  displayName: z.string().optional(),
  // G2: set-target action 帶這個 (NT$ 整數)；其他 action 忽略
  // null = 清掉該成員的 accepted_target (表態「我沒意見、跟群組走」)
  target: z.number().positive().nullable().optional()
});

/** GET — 列出某 group watch 的所有 member + 該 sub 的 consensus rule + derived target */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const subId = parseInt(params.id, 10);
  if (isNaN(subId)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }
  const supabase = getSupabase();

  // 同時拿 sub (要 consensus_rule + max_price) 跟 members
  const [subRes, memRes] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('consensus_rule, max_price')
      .eq('id', subId)
      .maybeSingle(),
    supabase
      .from('group_member')
      .select('line_user_id, display_name, accepted_target, joined_at')
      .eq('subscription_id', subId)
      .order('joined_at', { ascending: true })
  ]);

  if (subRes.error) {
    return NextResponse.json({ ok: false, error: subRes.error.message }, { status: 500 });
  }
  if (memRes.error) {
    return NextResponse.json({ ok: false, error: memRes.error.message }, { status: 500 });
  }
  return NextResponse.json({
    ok: true,
    members: memRes.data ?? [],
    // G2: 把 consensus_rule + derived_target 一起回，UI 不用重算
    consensusRule: subRes.data?.consensus_rule ?? 'max',
    derivedTarget: subRes.data?.max_price != null ? Number(subRes.data.max_price) : null
  });
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

  // 防呆：subscription 必須是 group watch 才能 join/leave/set-target
  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .select('id, source_type, consensus_rule')
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

  if (action === 'leave') {
    const { error } = await supabase
      .from('group_member')
      .delete()
      .eq('subscription_id', subId)
      .eq('line_user_id', body.userId);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    // G2: 離開後也要重算 derived target — 該成員的 target 不算數了
    const derived = await recomputeAndPersistDerived(supabase, subId, sub.consensus_rule);
    return NextResponse.json({ ok: true, action: 'left', derivedTarget: derived });
  }

  // === G2: action === 'set-target' ===
  // 必須先是 member 才能 set-target（leave 完不能再設）
  const target = body.target ?? null;
  const { data: existingMember, error: memCheckErr } = await supabase
    .from('group_member')
    .select('id')
    .eq('subscription_id', subId)
    .eq('line_user_id', body.userId)
    .maybeSingle();
  if (memCheckErr) {
    return NextResponse.json({ ok: false, error: memCheckErr.message }, { status: 500 });
  }
  if (!existingMember) {
    return NextResponse.json(
      { ok: false, error: 'not a member of this group watch — join first' },
      { status: 403 }
    );
  }

  const { error: updateErr } = await supabase
    .from('group_member')
    .update({ accepted_target: target })
    .eq('subscription_id', subId)
    .eq('line_user_id', body.userId);
  if (updateErr) {
    return NextResponse.json({ ok: false, error: updateErr.message }, { status: 500 });
  }

  const derived = await recomputeAndPersistDerived(supabase, subId, sub.consensus_rule);
  return NextResponse.json({ ok: true, action: 'target-set', derivedTarget: derived });
}

/**
 * G2: 重算 derived_target 並寫回 subscriptions.max_price (cron 用同欄判 alert)。
 *
 * 重要設計選擇：把 derived 寫進現有 max_price 而不是新欄位。理由：
 *   1. cron / sub-checker 0 改動 (一直讀 max_price)
 *   2. 個人訂閱 max_price 行為不變
 *   3. 加新欄位反而要改 ALL caller，bug 面積擴大
 *
 * 退化情境：rule='manual' 或全員無 target → derived=null → **不**寫回，
 * 保留建立者原本的 max_price。
 *
 * @returns 新的 derived target (= subscriptions.max_price after update) 或 null
 */
async function recomputeAndPersistDerived(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  subId: number,
  rule: ConsensusRule | null
): Promise<number | null> {
  const ruleNonNull: ConsensusRule = rule ?? 'max';
  const { data, error } = await supabase
    .from('group_member')
    .select('accepted_target')
    .eq('subscription_id', subId);
  if (error) {
    console.warn('[group-watch recompute] members fetch failed:', error.message);
    return null;
  }
  const derived = computeDerivedTarget(
    (data ?? []) as { accepted_target: number | null }[],
    ruleNonNull
  );
  if (derived == null) return null;

  const { error: writeErr } = await supabase
    .from('subscriptions')
    .update({ max_price: derived })
    .eq('id', subId);
  if (writeErr) {
    console.warn('[group-watch recompute] max_price update failed:', writeErr.message);
    return derived; // 仍回算出來的 derived 給 caller，DB 沒寫成沒辦法
  }
  return derived;
}
