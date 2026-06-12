import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/track — R4-C 點擊量測（「我也要追」成效指南針）
 *
 * LIFF 在帶 ?src= 的 deep link 打開時 fire-and-forget 打這支，
 * 寫一筆 click_event。分析直接在 Supabase 下 SQL（量小、不用 dashboard）。
 *
 * src 走白名單 — 不收任意字串（防垃圾資料 / 濫打）。
 * 失敗回 ok:false 但 200 — 量測掛了不能影響 LIFF 主流程（client 端也是 catch 後不管）。
 */
const KNOWN_SRC = ['group-alert'] as const;

const PostBody = z.object({
  src: z.enum(KNOWN_SRC),
  /** 群組 ctx（C.../R...）— optional */
  ctx: z.string().max(64).nullable().optional(),
  /** 點的人 LINE userId — optional（LIFF 未登入時可缺） */
  userId: z.string().max(64).nullable().optional()
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: z.infer<typeof PostBody>;
  try {
    body = PostBody.parse(await req.json());
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid body' }, { status: 400 });
  }

  try {
    const { error } = await getSupabase().from('click_event').insert({
      src: body.src,
      ctx: body.ctx ?? null,
      line_user_id: body.userId ?? null
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // 表還沒建（migration 未跑）或 DB 掛 — log 完回 ok:false，不 5xx
    console.warn('[track] insert failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false });
  }
}
