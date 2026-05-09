import { NextRequest, NextResponse } from 'next/server';
import { getLineClient } from '@/lib/line';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 取得 LINE 群組顯示名稱（給訂閱頁標示用）
 * GET ?groupId=Cxxx
 *
 * 注意：bot 必須還在群組裡 LINE 才會回，離開群組後此 API 會 404。
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const groupId = req.nextUrl.searchParams.get('groupId');
  if (!groupId || !groupId.startsWith('C')) {
    return NextResponse.json({ ok: false, error: 'invalid groupId' }, { status: 400 });
  }

  try {
    const client = getLineClient();
    const summary = await client.getGroupSummary(groupId);
    return NextResponse.json({
      ok: true,
      groupId: summary.groupId,
      groupName: summary.groupName,
      pictureUrl: summary.pictureUrl ?? null
    });
  } catch (err) {
    // bot 不在群組裡或群組不存在
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'failed' },
      { status: 404 }
    );
  }
}
