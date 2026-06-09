/**
 * /liff — Watchlist 主入口（PR #3 後變成 LIFF 的「家」）。
 *
 * 之前這個路徑沒 page.tsx，使用者點 LINE 連結進來會走到舊的 /liff/search 或
 * /liff/subscriptions。PR #3 之後，rich menu / 訊息連結改指向 /liff 直接看到
 * watchlist。舊三條路由（search / subscriptions / settings）保留，PR #4 才退場。
 */
import WatchlistView from './WatchlistView';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: '追蹤清單 · Travl',
  description: '一覽你追蹤的航班路線與當前最低價'
};

export default function LiffWatchlistPage() {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID ?? '';
  return <WatchlistView liffId={liffId} />;
}
