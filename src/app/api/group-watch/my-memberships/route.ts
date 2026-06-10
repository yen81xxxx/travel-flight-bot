/**
 * GET /api/group-watch/my-memberships?userId=Uxxx
 *
 * G0: 列出某個 LINE userId 加入的所有 group watch 對應的 subscription_id。
 * 給前端 useWatchlist 用：
 *   - 個人訂閱 — 直接打 with-quotes?sourceId=Uxxx
 *   - 群組訂閱 — 先打這支拿 subscription_id 清單，再用對應 group sourceId
 *     打 with-quotes?sourceId=Cxxx（個別群組）
 *
 * 為何不直接回完整 group watch payload：
 *   - with-quotes 已有完整 quote / intel 計算邏輯，重覆會 bug 不一致
 *   - 這支只負責「membership lookup」，職責單純好測
 *
 * Backward compat：
 *   - 新訂閱在 G1 join 流程才會寫 group_member
 *   - 既有 source_type='group' 訂閱沒 group_member 紀錄 → 這支回空 list
 *   - useWatchlist 同時也用 localStorage knownGroupCtxs，舊用法仍然 work
 *
 * Returns:
 *   { ok: true, subscriptionIds: number[] }
 *   或失敗 { ok: false, error: string }
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'userId required' }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('group_member')
    .select('subscription_id')
    .eq('line_user_id', userId);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // dedupe — 防止 schema 有問題（unique constraint 應已防止，但保險）
  const ids = Array.from(new Set(((data ?? []) as { subscription_id: number }[]).map(r => r.subscription_id)));
  return NextResponse.json({ ok: true, subscriptionIds: ids });
}
