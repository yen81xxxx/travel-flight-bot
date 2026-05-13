import { NextResponse } from 'next/server';
import { getSupabase } from '@/lib/supabase';
import { checkEnvironmentSecurity } from '@/lib/security';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 健康檢查 endpoint。
 * 確認：環境變數齊全 + Supabase 可連線。
 */
export async function GET(): Promise<NextResponse> {
  const checks: Record<string, { ok: boolean; detail?: string }> = {};

  // 1. env vars - use centralized security check
  const missing = checkEnvironmentSecurity();
  checks.environment = { ok: missing.length === 0, detail: missing.length > 0 ? `Missing: ${missing.join(', ')}` : undefined };

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
