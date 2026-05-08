import { NextRequest, NextResponse } from 'next/server';
import type { WebhookEvent } from '@line/bot-sdk';
import { verifyLineSignature } from '@/lib/line';
import { handleEvent } from '@/lib/bot-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Vercel Hobby 上限 60s（含 Fluid Compute），Pro 90s。航班搜尋約 5-15s。
export const maxDuration = 30;

/**
 * LINE Messaging API webhook endpoint.
 *
 * 設定方式：到 LINE Developers Console → Messaging API → Webhook URL
 * 填入 https://your-vercel-domain.vercel.app/api/line/webhook
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const signature = req.headers.get('x-line-signature');
  const rawBody = await req.text();

  // 1. 驗簽
  if (!verifyLineSignature(rawBody, signature)) {
    console.warn('[line/webhook] invalid signature');
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 });
  }

  // 2. parse
  let payload: { events?: WebhookEvent[] };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const events = payload.events ?? [];

  // 3. await 所有事件處理完才回 200。
  // Vercel serverless 在 response 送出後就會殺掉 process，背景 promise 不保證跑完，
  // 所以一定要 await。LINE 的 webhook timeout 比函式 maxDuration 寬鬆。
  await Promise.allSettled(events.map(ev => safeHandle(ev)));

  return NextResponse.json({ ok: true });
}

async function safeHandle(event: WebhookEvent): Promise<void> {
  try {
    await handleEvent(event);
  } catch (err) {
    console.error('[line/webhook] event handler error:', err);
  }
}
