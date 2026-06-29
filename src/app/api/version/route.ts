import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 輕量部署版本端點 — 用來無副作用驗證 Vercel 是否已經部署新 code。
 * 改卡片版面或關鍵邏輯時 bump CARD_VERSION，部署後 curl 這條就能立刻知道是否已生效。
 */
const CARD_VERSION = 'v54-digest-airline-rows-times-2026-06-29';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    cardVersion: CARD_VERSION,
    serverTime: new Date().toISOString()
  });
}
