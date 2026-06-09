/**
 * /liff/subscriptions — 舊路由（已被 PR #4a Vision watchlist 取代）。
 *
 * Server-side redirect 回 /liff 主入口（保留 ?ctx= 群組情境）。
 * 退場時程：保留至少 1 個月後再刪除整個資料夾。
 */
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface Props {
  searchParams: { ctx?: string; goto?: string };
}

export default function LiffSubscriptionsRedirect({ searchParams }: Props) {
  const ctx = searchParams.ctx;
  const qs = ctx && (ctx.startsWith('C') || ctx.startsWith('R'))
    ? `?ctx=${encodeURIComponent(ctx)}`
    : '';
  redirect(`/liff${qs}`);
}
