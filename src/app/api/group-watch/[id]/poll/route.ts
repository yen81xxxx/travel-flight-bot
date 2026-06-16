/**
 * /api/group-watch/[id]/poll — group watch 的「日期投票」
 *
 * G3 範圍：
 *   - GET   → 列出該 group watch 的所有 date options + 每個 option 的 voters + caller 的 myVote
 *   - POST  → body.action 分流：
 *              'add-option'    member 新增日期選項（如已存在同日期，靜默成功）
 *              'vote'          投票 / 換票（UNIQUE 走 upsert）
 *              'remove-option' member 移除某個選項（任何成員都能移除任何選項 — 共享投票
 *                              的 KISS 設計；移除會連同該選項的票一起 CASCADE 刪掉）
 *
 * ⚠️ 注意：date_option 沒有 creator 欄位，所以「只能刪自己加的」無法強制（也非
 *    本意）。三個 action 都要求 caller 是 group_member（見下方 membership gate），
 *    外人無法亂動。若日後要改成「只有創建者能刪」需先加 created_by_user_id 欄位。
 *
 * Schema (G0 migration 已建):
 *   date_option(id, subscription_id, out_date, ret_date)  UNIQUE(sub_id, out_date, ret_date)
 *   date_vote  (id, date_option_id, subscription_id, line_user_id)  UNIQUE(sub_id, user_id) ← 一人一票
 *
 * 投票切換：因為 UNIQUE(sub_id, user_id)，換選項 = upsert 同一筆 row → 自動覆蓋。
 *
 * ⚠️ SECURITY — 同 group-watch/[id]/route.ts 的已知限制（產品決策 2026-06-16：
 *   先不修，記錄就好）：caller userId 自己宣稱、沒驗 LIFF id-token。本檔三個 action
 *   都已要求 caller 是 group_member（防外人亂寫），但 member 身分本身建立在自宣稱的
 *   userId 上。完整修法見 group-watch/[id]/route.ts 檔頭 SECURITY 區塊。
 */
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const PostBody = z.object({
  action: z.enum(['add-option', 'vote', 'remove-option']),
  userId: z.string().min(1),
  // for add-option
  outDate: z.string().regex(DATE_RE).optional(),
  retDate: z.string().regex(DATE_RE).nullable().optional(),
  // for vote / remove-option
  optionId: z.number().int().positive().optional()
});

interface VoterRow {
  line_user_id: string;
  display_name: string | null;
}

/** GET — 列 options + voters + caller's myVote */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const subId = parseInt(params.id, 10);
  if (isNaN(subId)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }
  const callerUserId = req.nextUrl.searchParams.get('userId');  // 可選；用來算 myVote

  const supabase = getSupabase();
  const [optsRes, votesRes, membersRes] = await Promise.all([
    supabase
      .from('date_option')
      .select('id, out_date, ret_date, created_at')
      .eq('subscription_id', subId)
      .order('out_date', { ascending: true }),
    supabase
      .from('date_vote')
      .select('date_option_id, line_user_id')
      .eq('subscription_id', subId),
    // 拿 group_member 的 display_name，避免 voters 只有 LINE userId 看不懂
    supabase
      .from('group_member')
      .select('line_user_id, display_name')
      .eq('subscription_id', subId)
  ]);

  if (optsRes.error) return NextResponse.json({ ok: false, error: optsRes.error.message }, { status: 500 });
  if (votesRes.error) return NextResponse.json({ ok: false, error: votesRes.error.message }, { status: 500 });
  if (membersRes.error) return NextResponse.json({ ok: false, error: membersRes.error.message }, { status: 500 });

  const nameByUserId = new Map<string, string | null>();
  for (const m of (membersRes.data ?? []) as VoterRow[]) {
    nameByUserId.set(m.line_user_id, m.display_name);
  }

  // group votes by option_id
  const votesByOption = new Map<number, { line_user_id: string; display_name: string | null }[]>();
  let myVote: number | null = null;
  for (const v of (votesRes.data ?? []) as { date_option_id: number; line_user_id: string }[]) {
    const list = votesByOption.get(v.date_option_id) ?? [];
    list.push({ line_user_id: v.line_user_id, display_name: nameByUserId.get(v.line_user_id) ?? null });
    votesByOption.set(v.date_option_id, list);
    if (callerUserId && v.line_user_id === callerUserId) {
      myVote = v.date_option_id;
    }
  }

  const options = ((optsRes.data ?? []) as {
    id: number; out_date: string; ret_date: string | null; created_at: string;
  }[]).map(o => {
    const voters = votesByOption.get(o.id) ?? [];
    return {
      id: o.id,
      out_date: o.out_date,
      ret_date: o.ret_date,
      voters,
      voteCount: voters.length
    };
  });

  return NextResponse.json({ ok: true, options, myVote });
}

/** POST — add-option / vote / remove-option */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const subId = parseInt(params.id, 10);
  if (isNaN(subId)) {
    return NextResponse.json({ ok: false, error: 'invalid id' }, { status: 400 });
  }

  let body: z.infer<typeof PostBody>;
  try {
    body = PostBody.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid body' }, { status: 400 });
  }

  const supabase = getSupabase();

  // 防呆：sub 必須是 group 訂閱
  const { data: sub, error: subErr } = await supabase
    .from('subscriptions')
    .select('id, source_type')
    .eq('id', subId)
    .maybeSingle();
  if (subErr) return NextResponse.json({ ok: false, error: subErr.message }, { status: 500 });
  if (!sub) return NextResponse.json({ ok: false, error: 'subscription not found' }, { status: 404 });
  if (sub.source_type !== 'group') {
    return NextResponse.json({ ok: false, error: 'only group subscriptions support polling' }, { status: 400 });
  }

  // 防呆：caller 必須是 member（投票 / 新增選項都只有 member 才能做）
  const { data: member, error: memErr } = await supabase
    .from('group_member')
    .select('id')
    .eq('subscription_id', subId)
    .eq('line_user_id', body.userId)
    .maybeSingle();
  if (memErr) return NextResponse.json({ ok: false, error: memErr.message }, { status: 500 });
  if (!member) {
    return NextResponse.json(
      { ok: false, error: 'must be a member of this group watch first' },
      { status: 403 }
    );
  }

  // === add-option ===
  if (body.action === 'add-option') {
    if (!body.outDate) {
      return NextResponse.json({ ok: false, error: 'outDate required for add-option' }, { status: 400 });
    }
    // UNIQUE(sub_id, out_date, ret_date) 防同日期重複；upsert 失敗會回錯，但同
    // 日期已存在時應該靜默成功 → 用 onConflict ignoreDuplicates
    const { data, error } = await supabase
      .from('date_option')
      .upsert(
        {
          subscription_id: subId,
          out_date: body.outDate,
          ret_date: body.retDate ?? null
        },
        { onConflict: 'subscription_id,out_date,ret_date', ignoreDuplicates: true }
      )
      .select('id')
      .maybeSingle();
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    // ignoreDuplicates=true 時若 dup 會回 null data — 用 select 拿既有的 id 回給 caller
    let optionId = data?.id;
    if (!optionId) {
      const { data: existing } = await supabase
        .from('date_option')
        .select('id')
        .eq('subscription_id', subId)
        .eq('out_date', body.outDate)
        .eq('ret_date', body.retDate ?? null)
        .maybeSingle();
      optionId = existing?.id;
    }
    return NextResponse.json({ ok: true, action: 'option-added', optionId });
  }

  // === vote ===
  if (body.action === 'vote') {
    if (!body.optionId) {
      return NextResponse.json({ ok: false, error: 'optionId required for vote' }, { status: 400 });
    }
    // 驗 option 確實屬於這個 sub（防跨 sub 投錯）
    const { data: opt, error: optErr } = await supabase
      .from('date_option')
      .select('id, subscription_id')
      .eq('id', body.optionId)
      .maybeSingle();
    if (optErr) return NextResponse.json({ ok: false, error: optErr.message }, { status: 500 });
    if (!opt || opt.subscription_id !== subId) {
      return NextResponse.json({ ok: false, error: 'option does not belong to this group watch' }, { status: 400 });
    }
    // UNIQUE(subscription_id, line_user_id) → 同 user 換 option 自動 upsert 覆蓋
    const { error: voteErr } = await supabase
      .from('date_vote')
      .upsert(
        {
          date_option_id: body.optionId,
          subscription_id: subId,
          line_user_id: body.userId
        },
        { onConflict: 'subscription_id,line_user_id', ignoreDuplicates: false }
      );
    if (voteErr) return NextResponse.json({ ok: false, error: voteErr.message }, { status: 500 });
    return NextResponse.json({ ok: true, action: 'voted' });
  }

  // === remove-option ===
  // (任何 member 都能 remove — KISS。後續可加「只有 caller 自己加的才能 remove」)
  if (!body.optionId) {
    return NextResponse.json({ ok: false, error: 'optionId required for remove-option' }, { status: 400 });
  }
  // 驗 option 屬於這個 sub
  const { data: optCheck } = await supabase
    .from('date_option')
    .select('id, subscription_id')
    .eq('id', body.optionId)
    .maybeSingle();
  if (!optCheck || optCheck.subscription_id !== subId) {
    return NextResponse.json({ ok: false, error: 'option not found' }, { status: 404 });
  }
  // CASCADE 會自動把 date_vote 也刪掉（migration 設了 ON DELETE CASCADE）
  const { error: delErr } = await supabase
    .from('date_option')
    .delete()
    .eq('id', body.optionId);
  if (delErr) return NextResponse.json({ ok: false, error: delErr.message }, { status: 500 });
  return NextResponse.json({ ok: true, action: 'option-removed' });
}
