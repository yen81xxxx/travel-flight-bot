'use client';

import { useEffect, useState } from 'react';

/**
 * LIFF endpoint 頁面（/liff/search）的早期路由攔截。
 *
 * 因為 LIFF deep link 只認 endpoint URL，我們把所有「需要 LIFF 認證」的子流程
 * 都包成「liff.line.me/{LIFF_ID}?goto=XXX&...」格式，由本 gate 在 LIFF 載入後
 * 立刻 client-side replace 到對應子路徑（同 origin → LIFF context 持續有效）。
 *
 * 目前支援：
 *   goto=share → /liff/share?<其餘 params>  (從每日卡片「↪ 分享給朋友」進來)
 */
export default function RedirectGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    const goto = url.searchParams.get('goto');
    if (goto === 'share') {
      url.searchParams.delete('goto');
      window.location.replace(`/liff/share${url.search}`);
      return;
    }
    setReady(true);
  }, []);

  if (!ready) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#000', color: '#94a3b8', fontSize: 14 }}>
        載入中…
      </div>
    );
  }
  return <>{children}</>;
}
