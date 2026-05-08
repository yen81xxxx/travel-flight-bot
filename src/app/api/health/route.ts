import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 健康檢查 endpoint。
 * 確認：環境變數齊全 + Supabase 可連線。
 */
export async function GET(): Promise<NextResponse> {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // 1. env vars
  const required = [
    'SERPAPI_KEY',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'LINE_CHANNEL_ACCESS_TOKEN',
    'LINE_CHANNEL_SECRET',
    'CRON_SECRET'
  ];
  for (const k of required) {
    checks[`env.${k}`] = { ok: !!process.env[k] };
  }

  // 2. Supabase
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('conversation_state')
      .select('source_id', { count: 'exact', head: true });
    checks.supabase = { ok: !error, detail: error?.message };
  } catch (err) {
    checks.supabase = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }

  const allOk = Object.values(checks).every(c => c.ok);
  return NextResponse.json(
    { ok: allOk, checks, time: new Date().toISOString() },
    { status: allOk ? 200 : 503 }
  );
}
